'use client';

// Project wizard — replaces the previous grid-of-sections layout on
// /projects/[id] with a guided 4-step flow:
//
//   1 · Your brief         — tag picker (existing BriefPicker)
//   2 · Your room          — photo upload INSIDE the project
//   3 · Designer review    — combined Claude analysis + three-carousel chooser
//   4 · Render             — gallery of renders for this project
//
// Step progression is data-driven, not client-state-driven:
//   - Step 1 done when projects.brief.tags is non-empty
//   - Step 2 done when at least one room belongs to this project
//   - Step 3 done when the project has at least one render queued/done
//   - Step 4 is the destination — never "done", just shows results
//
// Users can revisit any prior step by clicking its header. The current
// step is the furthest INCOMPLETE step on first load.
//
// This is the wizard SKELETON (#123). #124 will defer Claude calls until
// Step 3's explicit trigger. #125 will combine brief + photo into one
// Claude analysis. #126 will replace Step 3's placeholder with the
// three-carousel chooser. #127 will add the avoid-modal. Each ships as
// its own commit so the UX shape lands first and the depth follows.

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import {
  BriefPicker,
  type BriefPaletteLookup,
  type BriefStyleLookup,
} from '@/components/projects/brief-picker';
import type { BriefSynthesis } from '@/lib/brief/synthesiser';

interface WizardRoom {
  id: string;
  /** Signed URL ready to render in an <Image> — server-rendered. */
  signedPhotoUrl: string | null;
  hasAnalysis: boolean;
  createdAt: string;
}

interface WizardRender {
  id: string;
  status: string;
  outputUrl: string | null;
  createdAt: string;
}

interface ProjectWizardProps {
  projectId: string;
  initialBriefTags: string[];
  initialBriefResponse: BriefSynthesis | null;
  palettes: BriefPaletteLookup[];
  styles: BriefStyleLookup[];
  rooms: WizardRoom[];
  renders: WizardRender[];
}

type StepIndex = 1 | 2 | 3 | 4;

const STEPS: { index: StepIndex; label: string; helper: string }[] = [
  { index: 1, label: 'Your brief',      helper: 'How you live, what you love' },
  { index: 2, label: 'Your room',       helper: 'Upload a photo — swap freely until you like it' },
  { index: 3, label: 'Designer review', helper: 'Claude reads your brief + room together' },
  { index: 4, label: 'Render',          helper: 'Your room, restyled' },
];

export function ProjectWizard({
  projectId,
  initialBriefTags,
  initialBriefResponse,
  palettes,
  styles,
  rooms,
  renders,
}: ProjectWizardProps) {
  // Step completion derived from data — single source of truth.
  const briefDone = initialBriefTags.length > 0;
  const photoDone = rooms.length > 0;
  const reviewDone = initialBriefResponse !== null && photoDone;
  const renderExists = renders.length > 0;

  // First-load: jump to the furthest incomplete step. User can still
  // click back to any prior step via the header.
  const initialStep: StepIndex = useMemo(() => {
    if (!briefDone) return 1;
    if (!photoDone) return 2;
    if (!reviewDone) return 3;
    if (!renderExists) return 3; // review done but no render yet — still on 3
    return 4;
  }, [briefDone, photoDone, reviewDone, renderExists]);

  const [currentStep, setCurrentStep] = useState<StepIndex>(initialStep);

  return (
    <section className="space-y-8">
      <WizardHeader
        currentStep={currentStep}
        onJump={setCurrentStep}
        completion={{ 1: briefDone, 2: photoDone, 3: reviewDone, 4: renderExists }}
      />

      {currentStep === 1 ? (
        <Step1Brief
          projectId={projectId}
          initialTags={initialBriefTags}
          initialResponse={initialBriefResponse}
          palettes={palettes}
          styles={styles}
          onContinue={() => setCurrentStep(2)}
          briefDone={briefDone}
        />
      ) : null}

      {currentStep === 2 ? (
        <Step2Room
          projectId={projectId}
          rooms={rooms}
          onContinue={() => setCurrentStep(3)}
          briefDone={briefDone}
        />
      ) : null}

      {currentStep === 3 ? (
        <Step3Review
          projectId={projectId}
          briefResponse={initialBriefResponse}
          palettes={palettes}
          styles={styles}
          briefDone={briefDone}
          photoDone={photoDone}
          onContinue={() => setCurrentStep(4)}
        />
      ) : null}

      {currentStep === 4 ? (
        <Step4Render projectId={projectId} renders={renders} />
      ) : null}
    </section>
  );
}

// --- Wizard header / stepper ---------------------------------------------

function WizardHeader({
  currentStep,
  onJump,
  completion,
}: {
  currentStep: StepIndex;
  onJump: (step: StepIndex) => void;
  completion: Record<StepIndex, boolean>;
}) {
  return (
    <ol className="grid gap-2 md:grid-cols-4">
      {STEPS.map((s) => {
        const isActive = s.index === currentStep;
        const isDone = completion[s.index];
        const isClickable = isDone || s.index === currentStep || s.index < currentStep;
        return (
          <li key={s.index}>
            <button
              type="button"
              onClick={() => (isClickable ? onJump(s.index) : null)}
              disabled={!isClickable}
              className={cn(
                'w-full rounded-xl border p-4 text-left transition',
                isActive
                  ? 'border-clay/60 bg-cream shadow-soft'
                  : isDone
                    ? 'border-olive/30 bg-paper-warm bg-grain'
                    : 'border-ink/[0.06] bg-cream/40',
                isClickable && !isActive ? 'hover:border-ink/20' : '',
                !isClickable ? 'cursor-not-allowed opacity-60' : '',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'grid h-7 w-7 place-items-center rounded-full font-mono text-meta',
                    isActive
                      ? 'bg-clay text-paper'
                      : isDone
                        ? 'bg-olive/80 text-paper'
                        : 'bg-ink/10 text-ink-faint',
                  )}
                  aria-hidden
                >
                  {isDone && !isActive ? '✓' : s.index}
                </span>
                <p className="font-display text-h4 text-ink">{s.label}</p>
              </div>
              <p className="mt-2 text-[13px] text-ink-soft">{s.helper}</p>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// --- Step 1: brief --------------------------------------------------------

function Step1Brief({
  projectId,
  initialTags,
  initialResponse,
  palettes,
  styles,
  onContinue,
  briefDone,
}: {
  projectId: string;
  initialTags: string[];
  initialResponse: BriefSynthesis | null;
  palettes: BriefPaletteLookup[];
  styles: BriefStyleLookup[];
  onContinue: () => void;
  briefDone: boolean;
}) {
  // Reuse the existing BriefPicker as-is. It still calls /api/projects/
  // [id]/brief which currently both persists tags AND runs Claude. #124
  // will refactor that endpoint to defer the synthesiser until Step 3.
  return (
    <StepShell
      stepIndex={1}
      title="Tell us how you live"
      intro="Pick tags across each section. The designer will use these to recommend a colour direction in Step 3."
    >
      <BriefPicker
        projectId={projectId}
        initialTags={initialTags}
        initialResponse={initialResponse}
        palettes={palettes}
        styles={styles}
      />
      {briefDone ? (
        <div className="mt-6 flex justify-end">
          <Button variant="cta" size="lg" onClick={onContinue}>
            Continue to Step 2 →
          </Button>
        </div>
      ) : null}
    </StepShell>
  );
}

// --- Step 2: room photo ---------------------------------------------------

function Step2Room({
  projectId,
  rooms,
  onContinue,
  briefDone,
}: {
  projectId: string;
  rooms: WizardRoom[];
  onContinue: () => void;
  briefDone: boolean;
}) {
  const latestRoom = rooms[0];
  return (
    <StepShell
      stepIndex={2}
      title="Show us your room"
      intro="A daylit photo works best. The designer doesn't read it yet — that happens in Step 3, after you confirm the photo is the one you want."
    >
      {!briefDone ? (
        <div className="rounded-xl border border-clay/40 bg-clay/5 p-5">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Finish Step 1 first
          </p>
          <p className="mt-2 text-[14px] text-ink-soft">
            The room photo needs your brief tags to give the designer enough
            context to recommend a direction.
          </p>
        </div>
      ) : null}

      {latestRoom ? (
        <div className="space-y-4">
          {latestRoom.signedPhotoUrl ? (
            <div className="relative aspect-[4/3] w-full max-w-2xl overflow-hidden rounded-xl border border-ink/[0.06] bg-cream">
              <Image
                src={latestRoom.signedPhotoUrl}
                alt="Your room"
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 672px"
                unoptimized
              />
            </div>
          ) : (
            <p className="text-[14px] text-ink-soft">Photo uploaded — preview unavailable.</p>
          )}
          <div className="flex flex-wrap gap-3">
            <Link href={`/rooms/new?projectId=${projectId}`}>
              <Button variant="ghost" size="md">
                ↺ Upload a different photo
              </Button>
            </Link>
            <Button variant="cta" size="lg" onClick={onContinue}>
              This is the one · Continue →
            </Button>
          </div>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Note · #124 will move the upload inline here so you can swap
            without leaving the wizard.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-ink/15 bg-paper-warm bg-grain p-10 text-center">
          <p className="font-display text-h4 text-ink">No photo yet</p>
          <p className="mt-2 max-w-md mx-auto text-[14px] text-ink-soft">
            Open the upload screen to add a photo for this project. The wizard
            will continue once a photo is attached.
          </p>
          <div className="mt-6">
            <Link href={`/rooms/new?projectId=${projectId}`}>
              <Button variant="cta" size="lg" disabled={!briefDone}>
                Upload a room photo →
              </Button>
            </Link>
          </div>
        </div>
      )}
    </StepShell>
  );
}

// --- Step 3: designer review ---------------------------------------------

function Step3Review({
  projectId,
  briefResponse,
  palettes,
  styles,
  briefDone,
  photoDone,
  onContinue,
}: {
  projectId: string;
  briefResponse: BriefSynthesis | null;
  palettes: BriefPaletteLookup[];
  styles: BriefStyleLookup[];
  briefDone: boolean;
  photoDone: boolean;
  onContinue: () => void;
}) {
  const ready = briefDone && photoDone;

  return (
    <StepShell
      stepIndex={3}
      title="Designer review"
      intro="Claude reads your brief and your room together, then recommends a colour direction. You'll get three carousels to lock in your choice."
    >
      {!ready ? (
        <div className="rounded-xl border border-clay/40 bg-clay/5 p-6">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Almost there
          </p>
          <p className="mt-2 max-w-xl text-[14px] text-ink-soft">
            Complete {!briefDone ? 'your brief (Step 1)' : 'your photo (Step 2)'} first
            — the designer needs both before recommending a direction.
          </p>
        </div>
      ) : briefResponse ? (
        // Existing brief response card lives below for now. #126 replaces
        // this whole block with the three-carousel chooser.
        <BriefReviewPlaceholder
          response={briefResponse}
          palettes={palettes}
          styles={styles}
        />
      ) : (
        <div className="rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-8 text-center">
          <p className="font-display text-h4 text-ink">
            Ready when you are.
          </p>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-soft">
            Hit the analyse button below and the designer will read your room
            and your brief together. Usually 15–25 seconds.
          </p>
          <p className="mx-auto mt-6 max-w-md rounded-lg border border-clay/30 bg-cream p-4 text-left font-mono text-meta uppercase tracking-eyebrow text-clay">
            #124–#126 in flight · this button will trigger a single
            unified Claude call (room analysis + brief synthesis) and
            replace this placeholder with the three-carousel chooser.
          </p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={`/rooms/new?projectId=${projectId}`}>
          <Button variant="cta" size="lg" disabled={!ready}>
            ✦ Generate render
          </Button>
        </Link>
        <Button variant="ghost" size="md" onClick={onContinue}>
          See past renders →
        </Button>
      </div>
    </StepShell>
  );
}

function BriefReviewPlaceholder({
  response,
  palettes,
  styles,
}: {
  response: BriefSynthesis;
  palettes: BriefPaletteLookup[];
  styles: BriefStyleLookup[];
}) {
  const palette = palettes.find((p) => p.id === response.recommendation.palette_id);
  const style = styles.find((s) => s.slug === response.recommendation.style_slug);
  return (
    <div className="rounded-2xl border border-ink/[0.06] bg-cream p-6 md:p-8 shadow-soft">
      <Eyebrow>Designer recommendation</Eyebrow>
      <p className="mt-3 max-w-2xl font-display text-[20px] leading-snug text-ink">
        {response.what_you_said}
      </p>
      {palette ? (
        <div className="mt-6 flex flex-wrap items-center gap-5 rounded-xl border border-clay/30 bg-paper-warm bg-grain p-5">
          <div className="w-44">
            <PaletteStrip colors={palette.swatch} className="h-8" />
          </div>
          <div>
            <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
              Recommended palette
            </p>
            <p className="mt-1 font-display text-h3 text-ink">{palette.name}</p>
            {style ? (
              <p className="mt-1 font-display italic text-ink-soft">
                with {style.name}
              </p>
            ) : null}
            {palette.timelessness !== undefined ? (
              <Pill tone={palette.timelessness >= 7 ? 'olive' : 'clay'} size="sm" className="mt-2">
                Timelessness {palette.timelessness}/10
              </Pill>
            ) : null}
          </div>
        </div>
      ) : null}
      <p className="mt-5 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
        {response.recommendation.reasoning}
      </p>
      <p className="mt-6 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
        Three-carousel chooser ships in #126 — for now, hit "Generate render" to
        proceed with the recommended palette.
      </p>
    </div>
  );
}

// --- Step 4: renders ------------------------------------------------------

function Step4Render({
  projectId,
  renders,
}: {
  projectId: string;
  renders: WizardRender[];
}) {
  return (
    <StepShell
      stepIndex={4}
      title="Your renders"
      intro="Each render keeps the room geometry but restyles the surfaces and decor. Open one to see the shoppable picking list."
    >
      {renders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/15 bg-paper-warm bg-grain p-10 text-center">
          <p className="font-display text-h4 text-ink">No renders yet</p>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-ink-soft">
            Finish Step 3 and hit "Generate render" to see your room restyled.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {renders.map((r) => (
            <li key={r.id}>
              <Link
                href={`/renders/${r.id}`}
                className="group block overflow-hidden rounded-xl border border-ink/[0.06] bg-cream transition hover:border-clay/40"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-ink/[0.04]">
                  {r.outputUrl ? (
                    // Output URL is the storage key; in practice the page
                    // signs these server-side. For the skeleton, fall back
                    // to a placeholder if we don't have a signed URL.
                    <Image
                      src={r.outputUrl}
                      alt="Render"
                      fill
                      sizes="320px"
                      className="object-cover transition group-hover:scale-105"
                      unoptimized
                    />
                  ) : (
                    <div className="grid h-full place-items-center font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                      {r.status}
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <Pill tone={r.status === 'succeeded' ? 'olive' : 'clay'} size="sm" withDot>
                    {r.status}
                  </Pill>
                  <p className="mt-2 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                    {new Date(r.createdAt).toLocaleString('en-AU')}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6">
        <Link href={`/rooms/new?projectId=${projectId}`}>
          <Button variant="cta" size="lg">
            ✦ New render
          </Button>
        </Link>
      </div>
    </StepShell>
  );
}

// --- Shared step shell ----------------------------------------------------

function StepShell({
  stepIndex,
  title,
  intro,
  children,
}: {
  stepIndex: StepIndex;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 md:p-10">
      <Eyebrow>Step {stepIndex}</Eyebrow>
      <p className="mt-2 font-display text-h3 text-ink">{title}</p>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-ink-soft">{intro}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}
