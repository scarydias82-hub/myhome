'use client';

// VisionBoardAnalysisCard — the "Get designer's read" surface on a
// vision board's detail page.
//
// States:
//   - No analysis yet → CTA + explainer
//   - Loading        → mid-call placeholder
//   - Result         → 4-section card (coherence + room styles +
//                      popularity + retailer recs)
//   - Stale          → "Board has changed since this read — refresh"
//                      banner above the result
//
// We fetch the latest analysis on mount via GET, so the surface is
// stable across page reloads without spending Claude budget. POST
// runs a fresh analysis on demand.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Pill } from '@/components/saltbush/pill';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AnalysisResponse {
  coherence: {
    through_line: string;
    tensions: string[];
    strength: 'high' | 'medium' | 'low';
    summary_for_user: string;
  };
  room_styles: string[];
  popularity: {
    comparable_boards: number;
    headline: string;
    differentiator: string;
  };
  retailer_recommendations: Array<{
    retailer: string;
    reason: string;
    categories: string[];
  }>;
}

interface AnalysisSnapshot {
  item_count: number;
  by_type: Record<string, number>;
}

interface CachedAnalysis {
  response: AnalysisResponse;
  snapshot: AnalysisSnapshot;
  createdAt: string;
}

export function VisionBoardAnalysisCard({
  boardId,
  currentItemCount,
}: {
  boardId: string;
  currentItemCount: number;
}) {
  const [cached, setCached] = useState<CachedAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the latest cached analysis on mount.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/vision-boards/${boardId}/analyse`)
      .then((r) => r.json())
      .then((j: { analysis?: CachedAnalysis | null }) => {
        if (cancelled) return;
        setCached(j.analysis ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function runAnalysis() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/vision-boards/${boardId}/analyse`, {
        method: 'POST',
      });
      const json = (await res.json().catch(() => ({}))) as {
        response?: AnalysisResponse;
        snapshot?: AnalysisSnapshot;
        error?: string;
      };
      if (!res.ok || !json.response) {
        setError(json.error ?? 'Could not run the analysis. Try again.');
        return;
      }
      setCached({
        response: json.response,
        snapshot: json.snapshot ?? { item_count: currentItemCount, by_type: {} },
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setRunning(false);
    }
  }

  // Stale if the board has drifted by ≥ 2 items since the analysis.
  // 2 is a guess; tune based on feedback.
  const stale =
    cached !== null && Math.abs(currentItemCount - cached.snapshot.item_count) >= 2;

  if (loading) {
    return (
      <section className="rounded-2xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 md:p-7">
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Loading designer&apos;s read…
        </p>
      </section>
    );
  }

  if (!cached && !running) {
    return <NoAnalysisYet boardId={boardId} itemCount={currentItemCount} onRun={runAnalysis} />;
  }

  if (running) {
    return <RunningPlaceholder />;
  }

  if (!cached) return null;

  return (
    <section className="rounded-2xl border border-clay/40 bg-gradient-to-br from-clay/[0.06] via-cream to-cream">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-ink/[0.06] p-5 md:flex-row md:items-baseline md:justify-between md:gap-4 md:p-6">
        <div>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Designer&apos;s read
          </p>
          <p className="mt-1 font-display text-h3 leading-tight text-ink md:text-[26px]">
            {cached.response.coherence.through_line}
          </p>
        </div>
        <StrengthBadge strength={cached.response.coherence.strength} />
      </div>

      {/* Stale banner */}
      {stale ? (
        <div className="flex flex-col gap-3 border-b border-ink/[0.06] bg-clay/[0.04] px-5 py-3 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="text-[13px] text-ink-soft md:text-[14px]">
            Your board has changed since this read. Refresh to get an updated take.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={runAnalysis}
            disabled={running}
          >
            ↻ Refresh
          </Button>
        </div>
      ) : null}

      {/* Body — 4 sections */}
      <div className="grid gap-5 p-5 md:gap-6 md:p-6">
        {/* 1. Coherence summary */}
        <div>
          <p className="font-dmsans text-[14px] leading-relaxed text-ink md:text-[15px]">
            {cached.response.coherence.summary_for_user}
          </p>
          {cached.response.coherence.tensions.length > 0 ? (
            <div className="mt-3 rounded-lg border border-ink/[0.06] bg-paper-warm bg-grain p-4">
              <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                Tensions to consider
              </p>
              <ul className="mt-2 space-y-1">
                {cached.response.coherence.tensions.map((t, i) => (
                  <li key={i} className="flex gap-2 text-[13px] text-ink-soft md:text-[14px]">
                    <span aria-hidden className="shrink-0 text-clay">·</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {/* 2. Room styles */}
        {cached.response.room_styles.length > 0 ? (
          <div>
            <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Applies to these room styles
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {cached.response.room_styles.map((s) => (
                <Pill key={s} tone="clay" size="sm">
                  {s.replace(/_/g, ' ')}
                </Pill>
              ))}
            </div>
          </div>
        ) : null}

        {/* 3. Popularity */}
        <div>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            How you compare
          </p>
          <p className="mt-2 font-display text-h4 leading-tight text-ink md:text-[18px]">
            {cached.response.popularity.headline}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
            {cached.response.popularity.differentiator}
          </p>
          {cached.response.popularity.comparable_boards > 0 ? (
            <p className="mt-2 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Based on {cached.response.popularity.comparable_boards} comparable boards
            </p>
          ) : null}
        </div>

        {/* 4. Retailer recommendations */}
        {cached.response.retailer_recommendations.length > 0 ? (
          <div>
            <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              Retailers to explore
            </p>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {cached.response.retailer_recommendations.map((r) => (
                <li
                  key={r.retailer}
                  className="flex flex-col gap-2 rounded-xl border border-ink/[0.06] bg-cream p-4"
                >
                  <p className="font-display text-h4 leading-tight text-ink md:text-[17px]">
                    {r.retailer}
                  </p>
                  <p className="text-[12px] leading-relaxed text-ink-soft md:text-[13px]">
                    {r.reason}
                  </p>
                  {r.categories.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {r.categories.slice(0, 3).map((c) => (
                        <Pill key={c} tone="cream" size="sm">
                          {c}
                        </Pill>
                      ))}
                    </div>
                  ) : null}
                  <Link
                    href={`/catalogue?retailer=${encodeURIComponent(r.retailer)}`}
                    className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline"
                  >
                    Browse {r.retailer} →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/[0.06] px-5 py-3 md:px-6">
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          Last read {formatRelative(cached.createdAt)}
        </p>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={running}
          className="font-mono text-meta uppercase tracking-eyebrow text-clay hover:underline disabled:opacity-50"
        >
          {running ? 'Refreshing…' : '↻ Re-run'}
        </button>
      </div>

      {error ? (
        <p className="border-t border-destructive/30 bg-destructive/5 px-5 py-3 text-[13px] text-destructive md:px-6">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function NoAnalysisYet({
  itemCount,
  onRun,
}: {
  boardId: string;
  itemCount: number;
  onRun: () => void;
}) {
  const ready = itemCount >= 2;
  return (
    <section
      className={cn(
        'flex flex-col gap-3 rounded-2xl border p-5 md:flex-row md:items-center md:justify-between md:p-6',
        ready
          ? 'border-clay/40 bg-clay/[0.06]'
          : 'border-ink/[0.06] bg-paper-warm bg-grain',
      )}
    >
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cream font-display text-h4 text-clay md:h-12 md:w-12 md:text-[20px]">
          ✦
        </div>
        <div>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Designer&apos;s read
          </p>
          <p className="mt-1 font-display text-h4 leading-tight text-ink md:text-[20px]">
            {ready
              ? 'Get a designer\'s take on your board'
              : 'Add a few more items first'}
          </p>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
            {ready
              ? "Claude reviews every palette, trend, product and note on your board and writes a designer-voice critique. You'll see what's working, what's pulling against the through-line, which room styles fit, how your board compares to others, and which AU retailers to explore for gaps."
              : 'The designer needs at least 2 items to write a meaningful read. Save a palette + a couple of products to unlock this.'}
          </p>
        </div>
      </div>
      {ready ? (
        <Button type="button" variant="cta" onClick={onRun}>
          ✦ Get designer&apos;s read
        </Button>
      ) : null}
    </section>
  );
}

function RunningPlaceholder() {
  return (
    <section className="rounded-2xl border border-clay/40 bg-clay/[0.06] p-6 md:p-7">
      <div className="flex items-start gap-4">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-clay/40 bg-cream md:h-12 md:w-12">
          <span aria-hidden className="animate-pulse text-clay text-[18px] md:text-[20px]">
            ◎
          </span>
        </div>
        <div>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            Designer&apos;s read
          </p>
          <p className="mt-1 font-display text-h4 leading-tight text-ink md:text-[20px]">
            Studying your board…
          </p>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-soft md:text-[14px]">
            Reading every palette, trend, product and note · comparing to other boards on
            myMaison · drafting a designer-voice take. ~15 seconds.
          </p>
          <div className="mt-3 h-1.5 w-44 overflow-hidden rounded-full bg-cream">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-clay" />
          </div>
        </div>
      </div>
    </section>
  );
}

function StrengthBadge({ strength }: { strength: 'high' | 'medium' | 'low' }) {
  const map: Record<typeof strength, { label: string; tone: 'olive' | 'clay' | 'cream' }> = {
    high: { label: 'Strong story', tone: 'olive' },
    medium: { label: 'Coming together', tone: 'clay' },
    low: { label: 'Still forming', tone: 'cream' },
  };
  const { label, tone } = map[strength];
  return <Pill tone={tone}>{label}</Pill>;
}

function formatRelative(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diff = now - then;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    return `${day} day${day === 1 ? '' : 's'} ago`;
  } catch {
    return '';
  }
}
