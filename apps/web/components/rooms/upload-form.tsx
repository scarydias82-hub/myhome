'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { Pill } from '@/components/saltbush/pill';
import { STYLES, type StyleSlug } from '@/lib/styles';
import { listPalettes, paletteSwatch, type Palette } from '@/lib/palettes';
import type { RoomAnalysis } from '@/lib/vision';
import { cn } from '@/lib/utils';

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const ALLOWED_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;

async function convertHeicToJpeg(file: File): Promise<Blob> {
  const buf = await file.arrayBuffer();
  const blob = new Blob([buf], { type: file.type || 'image/heic' });
  try {
    const mod = await import('heic-to');
    const result = await mod.heicTo({ blob, type: 'image/jpeg', quality: 0.92 });
    if (result instanceof Blob) return result;
  } catch (primary) {
    console.warn('heic-to failed, trying heic2any', primary);
  }
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
  const result = Array.isArray(out) ? out[0] : out;
  if (!result) throw new Error('no blob returned');
  return result;
}

interface AnalyseResponse {
  roomId: string;
  analysis: RoomAnalysis | null;
  error?: string;
}

interface FeaturedProduct {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
}

export function UploadForm({ projectId }: { projectId?: string | null }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<RoomAnalysis | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisConfirmed, setAnalysisConfirmed] = useState(false);

  const [style, setStyle] = useState<StyleSlug>('japandi');
  const [paletteId, setPaletteId] = useState<string>(listPalettes()[0]?.id ?? '');
  const [submitting, setSubmitting] = useState(false);

  // Hero products are an optional Step 5 — user selects up to 3 specific
  // catalogue items to "feature" so the Flux prompt biases toward them.
  const [heroProducts, setHeroProducts] = useState<FeaturedProduct[] | null>(null);
  const [heroLoading, setHeroLoading] = useState(false);
  const [featuredIds, setFeaturedIds] = useState<string[]>([]);

  // Trend-card previews per palette — loaded once the analysis confirms,
  // filtered by the room_type Claude identified so the palette swatches
  // show the user what each palette looks like in a room LIKE theirs.
  const [trendPreviews, setTrendPreviews] = useState<Map<string, TrendPreview>>(new Map());

  useEffect(() => {
    if (!analysisConfirmed) return;
    let cancelled = false;
    setHeroLoading(true);
    fetch(`/api/featured-products?style=${style}&paletteId=${paletteId}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setHeroProducts((j.products as FeaturedProduct[]) ?? []);
      })
      .catch(() => {})
      .finally(() => !cancelled && setHeroLoading(false));
    return () => {
      cancelled = true;
    };
  }, [analysisConfirmed, style, paletteId]);

  useEffect(() => {
    if (!analysisConfirmed) return;
    const roomType = analysis?.room_type ?? null;
    const url = roomType
      ? `/api/trend-previews?roomType=${encodeURIComponent(roomType)}`
      : '/api/trend-previews';
    let cancelled = false;
    fetch(url)
      .then((r) => r.json())
      .then((j: { previews?: TrendPreview[] }) => {
        if (cancelled) return;
        const map = new Map<string, TrendPreview>();
        for (const p of j.previews ?? []) map.set(p.paletteId, p);
        setTrendPreviews(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [analysisConfirmed, analysis?.room_type]);

  const isMobile =
    typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  useEffect(() => {
    fetch('/api/warm', { method: 'POST' }).catch(() => {});
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  async function handleFile(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      setPreview(null);
      setRoomId(null);
      setAnalysis(null);
      setAnalysisConfirmed(false);
      return;
    }
    const mimeOk = ALLOWED_MIME.includes(next.type);
    const extOk = ALLOWED_EXT.test(next.name);
    if (!mimeOk && !extOk) {
      setError('Use a JPG, PNG, WebP, or HEIC photo.');
      return;
    }
    if (next.size > MAX_BYTES) {
      setError('Photo is over 15 MB. Try a smaller one.');
      return;
    }
    const isHeic = /^image\/(heic|heif)$/i.test(next.type) || /\.(heic|heif)$/i.test(next.name);
    let usable = next;
    if (isHeic) {
      setConverting(true);
      try {
        const jpegBlob = await convertHeicToJpeg(next);
        const baseName = next.name.replace(/\.(heic|heif)$/i, '') || 'room';
        usable = new File([jpegBlob], `${baseName}.jpg`, { type: 'image/jpeg' });
      } catch (err) {
        console.error(err);
        setError('Could not convert HEIC. Export as JPG from Photos.');
        setConverting(false);
        return;
      }
      setConverting(false);
    }
    // Vercel serverless caps multipart body at 4.5MB. Modern phone photos are
    // routinely 8-15MB so we downscale client-side. 1600px wide is plenty for
    // Claude vision; the original file stays in the user's session if they
    // want to redo it from scratch.
    try {
      usable = await resizeForUpload(usable);
    } catch (err) {
      console.warn('resize failed, sending original', err);
    }
    setFile(usable);
    setPreview(URL.createObjectURL(usable));
    // Kick off analysis immediately.
    void analysePhoto(usable);
  }

  // Returns the file unchanged if it's already small enough; otherwise
  // re-encodes as JPEG at max 1600px wide. Preserves aspect ratio.
  async function resizeForUpload(file: File): Promise<File> {
    const TARGET_MAX_DIM = 1600;
    const TARGET_MAX_BYTES = 3.5 * 1024 * 1024; // safe under Vercel's 4.5MB cap
    if (file.size <= TARGET_MAX_BYTES) return file;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, TARGET_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88),
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'room';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  }

  async function analysePhoto(photoFile: File) {
    setAnalysing(true);
    setAnalysis(null);
    setRoomId(null);
    setAnalysisConfirmed(false);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('photo', photoFile);
      if (projectId) fd.append('projectId', projectId);
      const res = await fetch('/api/analyse-room', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as AnalyseResponse;
      if (!res.ok) {
        setError(json.error ?? 'Could not analyse the room. Try another photo.');
        return;
      }
      setRoomId(json.roomId);
      setAnalysis(json.analysis);
      if (!json.analysis) {
        setError(
          json.error ??
            'Vision analysis was unavailable, but you can still proceed. The restyle will be less precise.',
        );
        setAnalysisConfirmed(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Try again.');
    } finally {
      setAnalysing(false);
    }
  }

  async function openCamera() {
    setError(null);
    if (isMobile) {
      cameraInput.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access or upload a photo instead.'
          : 'Could not open the camera. Try uploading a photo instead.',
      );
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const captured = new File([blob], `room-${Date.now()}.jpg`, { type: 'image/jpeg' });
        void handleFile(captured);
        closeCamera();
      },
      'image/jpeg',
      0.92,
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roomId) {
      setError('Upload a photo first.');
      return;
    }
    if (!analysisConfirmed) {
      setError('Confirm the room analysis to continue.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, style, paletteId, featuredProductIds: featuredIds, projectId: projectId ?? undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !json.id) {
        setError(json.error ?? 'Render failed. Try again.');
        setSubmitting(false);
        return;
      }
      router.push(`/renders/${json.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <Step1Upload
        file={file}
        preview={preview}
        converting={converting}
        analysing={analysing}
        onPick={handleFile}
        onOpenCamera={openCamera}
        onBrowseFiles={() => fileInput.current?.click()}
      />
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
        capture="environment"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />

      {analysing ? <AnalysingPlaceholder /> : null}
      {analysis && !analysing ? (
        <Step2Review
          analysis={analysis}
          confirmed={analysisConfirmed}
          onConfirm={() => setAnalysisConfirmed(true)}
          onEdit={() => setAnalysisConfirmed(false)}
        />
      ) : null}

      {analysisConfirmed ? (
        <Step3Style
          style={style}
          onStyleChange={setStyle}
          paletteId={paletteId}
          onPaletteChange={setPaletteId}
          trendPreviews={trendPreviews}
        />
      ) : null}

      {analysisConfirmed ? (
        <Step5HeroProducts
          products={heroProducts}
          loading={heroLoading}
          selectedIds={featuredIds}
          onToggle={(id) =>
            setFeaturedIds((prev) =>
              prev.includes(id) ? prev.filter((i) => i !== id) : prev.length < 3 ? [...prev, id] : prev,
            )
          }
        />
      ) : null}

      {error ? <p className="text-[14px] text-destructive">{error}</p> : null}

      <div className="flex items-center gap-4">
        <Button
          type="submit"
          variant="cta"
          size="lg"
          disabled={!analysisConfirmed || submitting || converting || analysing}
        >
          {submitting ? 'Restyling… (~30s)' : 'Restyle the room'}
        </Button>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Grounded by Claude vision · rendered with Flux + canny
        </p>
      </div>

      {cameraOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-4">
          <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-cream">
            <div className="relative aspect-[4/3] w-full bg-ink">
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex items-center justify-between gap-3 p-5">
              <Button type="button" variant="secondary" onClick={closeCamera}>
                Cancel
              </Button>
              <Button type="button" variant="cta" size="lg" onClick={capturePhoto}>
                Capture photo
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}

function Step1Upload({
  file,
  preview,
  converting,
  onPick,
  onOpenCamera,
  onBrowseFiles,
}: {
  file: File | null;
  preview: string | null;
  converting: boolean;
  analysing: boolean;
  onPick: (f: File | null) => void;
  onOpenCamera: () => void;
  onBrowseFiles: () => void;
}) {
  return (
    <section>
      <Eyebrow>Step 01 · Your room</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">Upload a photo</h2>
      <p className="mt-2 max-w-xl text-[15px] text-ink-soft">
        Daylight works best. Stand back so the whole room fits in the frame. JPG, PNG, WebP, or
        HEIC up to 15 MB.
      </p>

      <div className={cn('mt-6 grid gap-6 md:grid-cols-2', file || converting ? '' : 'md:grid-cols-1')}>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPick(e.dataTransfer.files?.[0] ?? null);
          }}
          className={cn(
            'flex min-h-[260px] flex-col items-center justify-center gap-4',
            'rounded-xl border-2 border-dashed border-ink/15 bg-paper-warm bg-grain p-8 text-center',
            'transition hover:border-clay/40 hover:bg-paper-warm/80',
          )}
        >
          <p className="font-display text-h4 text-ink">Drop a photo here</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button type="button" variant="secondary" onClick={onBrowseFiles}>
              Browse files
            </Button>
            <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">or</span>
            <Button type="button" variant="cta" onClick={onOpenCamera}>
              Use camera
            </Button>
          </div>
          {file ? (
            <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
            </p>
          ) : null}
        </div>

        {preview ? (
          <div className="overflow-hidden rounded-xl border border-ink/[0.06] bg-cream">
            <Image
              src={preview}
              alt="Your room"
              width={800}
              height={600}
              className="h-full w-full object-cover"
              unoptimized
            />
          </div>
        ) : converting ? (
          <div className="grid min-h-[260px] place-items-center rounded-xl border border-ink/[0.06] bg-cream p-8 text-center">
            <div>
              <div className="mx-auto h-3 w-40 overflow-hidden rounded-full bg-ink/10">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
              </div>
              <p className="mt-4 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Converting HEIC → JPEG
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AnalysingPlaceholder() {
  return (
    <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-8 text-center">
      <div className="mx-auto h-3 w-40 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
      </div>
      <p className="mt-4 font-display text-h4 text-ink">Claude is reading your room…</p>
      <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
        Vision · ~8s
      </p>
    </div>
  );
}

function Step2Review({
  analysis,
  confirmed,
  onConfirm,
  onEdit,
}: {
  analysis: RoomAnalysis;
  confirmed: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  return (
    <section>
      <Eyebrow>Step 02 · What Claude sees</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">Confirm the room read</h2>
      <p className="mt-2 max-w-xl text-[15px] text-ink-soft">
        We've grounded the restyle on these observations. Confirm to lock them in; the render
        prompt will preserve your architecture and existing flooring.
      </p>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <FactCard label="Room">
          <p className="font-display text-h4 text-ink capitalize">
            {analysis.room_type?.replace(/_/g, ' ') ?? 'Unknown'}
          </p>
          {analysis.ceiling_height_m ? (
            <p className="mt-1 text-[14px] text-ink-soft">
              Approx. {analysis.ceiling_height_m}m ceilings
            </p>
          ) : null}
          {analysis.dimensions_approximate_m.width && analysis.dimensions_approximate_m.depth ? (
            <p className="mt-1 text-[14px] text-ink-soft">
              {analysis.dimensions_approximate_m.width}m × {analysis.dimensions_approximate_m.depth}m
            </p>
          ) : null}
        </FactCard>

        <FactCard label="Light">
          <p className="font-display text-h4 text-ink capitalize">
            {analysis.light.direction ? `${analysis.light.direction}-facing` : 'Direction unclear'}
          </p>
          {analysis.light.quality ? (
            <p className="mt-1 text-[14px] text-ink-soft">{analysis.light.quality}</p>
          ) : null}
        </FactCard>

        <FactCard label="Existing colours">
          <ul className="space-y-2">
            {analysis.existing_colours.slice(0, 4).map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-[14px] text-ink-soft">
                {c.hex ? (
                  <span
                    aria-hidden
                    style={{ background: c.hex }}
                    className="inline-block h-4 w-4 shrink-0 rounded-full border border-ink/10"
                  />
                ) : null}
                <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  {c.surface}
                </span>
                <span>{c.description}</span>
              </li>
            ))}
          </ul>
        </FactCard>

        <FactCard label="Architecture & flooring">
          {analysis.flooring ? (
            <p className="text-[14px] text-ink-soft">
              <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Floor ·{' '}
              </span>
              {analysis.flooring}
            </p>
          ) : null}
          {analysis.architectural_features.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {analysis.architectural_features.slice(0, 6).map((f) => (
                <Pill key={f} tone="cream" size="sm">
                  {f}
                </Pill>
              ))}
            </div>
          ) : null}
        </FactCard>

        {analysis.existing_furniture.length > 0 ? (
          <FactCard label="Existing furniture" wide>
            <ul className="grid gap-2 sm:grid-cols-2">
              {analysis.existing_furniture.map((f, i) => (
                <li key={i} className="flex items-center gap-2 text-[14px] text-ink-soft">
                  <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                    {f.condition}
                  </span>
                  <span>{f.item}</span>
                </li>
              ))}
            </ul>
          </FactCard>
        ) : null}
      </div>

      {!confirmed ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="button" variant="cta" onClick={onConfirm}>
            Looks right · continue
          </Button>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            You'll be able to override the style next
          </p>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Pill tone="olive" withDot>Confirmed</Pill>
          <button
            type="button"
            onClick={onEdit}
            className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
          >
            Edit
          </button>
        </div>
      )}
    </section>
  );
}

function FactCard({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-ink/[0.06] bg-cream p-5',
        wide ? 'md:col-span-2' : '',
      )}
    >
      <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Step5HeroProducts({
  products,
  loading,
  selectedIds,
  onToggle,
}: {
  products: FeaturedProduct[] | null;
  loading: boolean;
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <Eyebrow>Step 05 · Feature products (optional)</Eyebrow>
      <h2 className="mt-2 font-display text-h3 text-ink">Bias the render toward real SKUs</h2>
      <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">
        Pick up to 3 hero products from the AU catalogue. Their shape and palette will be woven
        into the Flux prompt so the render leans toward items you can actually buy. Skip to let
        the AI choose freely.
      </p>

      {loading || !products ? (
        <div className="mt-6 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 text-center">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Loading hero products…
          </p>
        </div>
      ) : products.length === 0 ? (
        <div className="mt-6 rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 text-center">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            No matched products yet — proceed without featuring any.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {products.map((p) => {
              const selected = selectedIds.includes(p.id);
              const disabled = !selected && selectedIds.length >= 3;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onToggle(p.id)}
                  disabled={disabled}
                  aria-pressed={selected}
                  className={cn(
                    'group flex flex-col gap-2 overflow-hidden rounded-xl border bg-cream text-left transition disabled:opacity-40',
                    selected ? 'border-clay shadow-soft' : 'border-ink/[0.06] hover:border-ink/20',
                  )}
                >
                  <div className="relative aspect-square w-full bg-paper-warm bg-grain">
                    <Image
                      src={p.image_url}
                      alt={p.name}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition group-hover:scale-[1.02]"
                      unoptimized
                    />
                    {selected ? (
                      <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-clay font-mono text-meta text-paper">
                        {selectedIds.indexOf(p.id) + 1}
                      </span>
                    ) : null}
                  </div>
                  <div className="p-3">
                    <p className="line-clamp-2 font-display text-[14px] leading-tight text-ink">
                      {p.name}
                    </p>
                    <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      {p.retailer}
                    </p>
                    {p.price_aud != null ? (
                      <p className="mt-1 font-display text-h4 text-ink">
                        ${Math.round(p.price_aud).toLocaleString('en-AU')}
                      </p>
                    ) : (
                      <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                        POA
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-4 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {selectedIds.length} / 3 selected
          </p>
        </>
      )}
    </section>
  );
}

interface TrendPreview {
  paletteId: string;
  headline: string;
  roomType: string;
  matchedRoomType: boolean;
  imageUrl: string;
}

function Step3Style({
  style,
  onStyleChange,
  paletteId,
  onPaletteChange,
  trendPreviews,
}: {
  style: StyleSlug;
  onStyleChange: (s: StyleSlug) => void;
  paletteId: string;
  onPaletteChange: (p: string) => void;
  trendPreviews: Map<string, TrendPreview>;
}) {
  return (
    <>
      <section>
        <Eyebrow>Step 03 · The aesthetic</Eyebrow>
        <h2 className="mt-2 font-display text-h3 text-ink">Pick a style</h2>
        <p className="mt-2 max-w-xl text-[15px] text-ink-soft">
          Each style seeds the render with a base palette, materials, and mood.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STYLES.map((s) => {
            const selected = s.slug === style;
            return (
              <button
                key={s.slug}
                type="button"
                onClick={() => onStyleChange(s.slug)}
                className={cn(
                  'group flex flex-col gap-3 rounded-xl border p-5 text-left transition',
                  selected
                    ? 'border-clay/60 bg-cream shadow-soft'
                    : 'border-ink/[0.06] bg-cream/60 hover:border-ink/20 hover:bg-cream',
                )}
                aria-pressed={selected}
              >
                <PaletteStrip colors={s.palette} className="h-7" />
                <div>
                  <p className="font-display text-h4 text-ink">{s.name}</p>
                  <p className="mt-1 text-[13px] text-ink-soft">{s.tagline}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <Eyebrow>Step 04 · 2026 palette</Eyebrow>
        <h2 className="mt-2 font-display text-h3 text-ink">Refine the colour direction</h2>
        <p className="mt-2 max-w-xl text-[15px] text-ink-soft">
          Optional. Overrides the style's base palette with a trend-forward 2026 palette.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listPalettes().map((p) => {
            const selected = paletteId === p.id;
            const preview = trendPreviews.get(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPaletteChange(p.id)}
                aria-pressed={selected}
                className={cn(
                  'group flex flex-col overflow-hidden rounded-xl border text-left transition',
                  selected
                    ? 'border-clay/60 bg-cream shadow-soft'
                    : 'border-ink/[0.06] bg-paper-warm bg-grain hover:border-ink/20 hover:bg-cream',
                )}
              >
                {/* Trend-card preview image — pre-rendered Flux output
                    showing what this palette looks like in a similar
                    room. Falls back to a swatch-only header when no
                    trend card is available for this palette. */}
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/5">
                  {preview?.imageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview.imageUrl}
                        alt={`${p.name} applied to a ${preview.roomType.replace(/_/g, ' ')}`}
                        className="absolute inset-0 h-full w-full object-cover"
                        loading="lazy"
                      />
                      {!preview.matchedRoomType ? (
                        <span className="absolute left-2 top-2 rounded-full bg-ink/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-eyebrow text-paper">
                          {preview.roomType.replace(/_/g, ' ')} sample
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <div className="absolute inset-0 grid place-items-center">
                      <div className="w-2/3">
                        <PaletteStrip colors={paletteSwatch(p)} className="h-7" />
                      </div>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <PaletteStrip colors={paletteSwatch(p)} className="h-5" />
                  <p className="mt-3 font-display text-h4 text-ink">{p.name}</p>
                  <p className="mt-1 text-[13px] text-ink-soft">{p.vibe}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
