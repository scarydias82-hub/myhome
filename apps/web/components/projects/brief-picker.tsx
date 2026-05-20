'use client';

// Project brief picker + Claude response card.
//
// Two states:
//   1. Picker open (collapsed if a saved brief exists). Multi-select tag
//      chips across 7 categories. "Ask the designer" CTA POSTs the
//      selected tags to /api/projects/[id]/brief and renders the response.
//   2. Response card visible (when a saved brief exists). Editorial
//      "designer note" surface — what-you-said, recommendation,
//      optional push-back, also-consider alternatives, avoid warnings.
//      "Edit your brief" re-opens the picker.
//
// Strictly client-side rendering — receives the initial state from the
// project page (server component) which seeds tags + response if one
// has been generated.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { PaletteStrip } from '@/components/saltbush/palette-strip';
import { BRIEF_TAG_GROUPS, type BriefTagGroup } from '@/lib/brief/taxonomy';
import type { BriefSynthesis } from '@/lib/brief/synthesiser';

export interface BriefPaletteLookup {
  id: string;
  name: string;
  vibe: string;
  swatch: string[]; // 5 hex codes in role order
}

export interface BriefStyleLookup {
  slug: string;
  name: string;
  tagline: string;
}

interface BriefPickerProps {
  projectId: string;
  initialTags: string[];
  initialResponse: BriefSynthesis | null;
  palettes: BriefPaletteLookup[];
  styles: BriefStyleLookup[];
}

export function BriefPicker({
  projectId,
  initialTags,
  initialResponse,
  palettes,
  styles,
}: BriefPickerProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialTags));
  const [response, setResponse] = useState<BriefSynthesis | null>(initialResponse);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Editing state — if we have a saved response, the picker collapses
  // into the response card. Hitting "Edit your brief" reopens it.
  const [editing, setEditing] = useState<boolean>(initialResponse === null);

  const paletteById = useMemo(
    () => new Map(palettes.map((p) => [p.id, p])),
    [palettes],
  );
  const styleBySlug = useMemo(
    () => new Map(styles.map((s) => [s.slug, s])),
    [styles],
  );

  function toggleTag(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  async function askDesigner() {
    if (selected.size === 0) {
      setError('Pick at least one tag before asking the designer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brief`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags: [...selected] }),
      });
      const json = (await res.json().catch(() => ({}))) as
        | { error?: string }
        | { tags: string[]; response: BriefSynthesis; updated_at: string };
      if (!res.ok) {
        setError(
          'error' in json && json.error
            ? json.error
            : 'Designer call failed. Try again in a minute.',
        );
        return;
      }
      if ('response' in json) {
        setResponse(json.response);
        setEditing(false);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  // RESPONSE-ONLY VIEW
  if (response && !editing) {
    return (
      <section className="rounded-2xl border border-ink/[0.06] bg-cream shadow-soft">
        <BriefResponseCard
          response={response}
          paletteById={paletteById}
          styleBySlug={styleBySlug}
          onEdit={() => setEditing(true)}
        />
      </section>
    );
  }

  // PICKER VIEW (with optional response below if it exists)
  return (
    <section className="space-y-8">
      <div className="rounded-2xl border border-ink/[0.06] bg-paper-warm bg-grain p-6 md:p-10">
        <Eyebrow>Your brief</Eyebrow>
        <p className="mt-2 font-display text-h3 text-ink">
          Tell us how you live.
        </p>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          Pick the tags that resonate across each section. Claude — playing the role of a
          senior Australian designer — will read the brief, recommend a palette and style
          direction, and push back honestly if your tags conflict.
        </p>

        <div className="mt-8 space-y-8">
          {BRIEF_TAG_GROUPS.map((group) => (
            <TagGroupSection
              key={group.category}
              group={group}
              selected={selected}
              onToggle={toggleTag}
            />
          ))}
        </div>

        {error ? (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-[14px] text-destructive">{error}</p>
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={askDesigner}
            disabled={busy || selected.size === 0}
            className="rounded-pill bg-ink px-6 py-3 font-mono text-meta uppercase tracking-eyebrow text-paper transition hover:bg-ink-soft disabled:opacity-40"
          >
            {busy
              ? 'Designer is reading…'
              : response
                ? `Re-ask the designer (${selected.size} ${selected.size === 1 ? 'tag' : 'tags'})`
                : `Ask the designer (${selected.size} ${selected.size === 1 ? 'tag' : 'tags'})`}
          </button>
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Claude Sonnet · ~10s
          </p>
        </div>
      </div>

      {response && editing ? (
        <section className="rounded-2xl border border-ink/[0.06] bg-cream shadow-soft">
          <BriefResponseCard
            response={response}
            paletteById={paletteById}
            styleBySlug={styleBySlug}
            onEdit={() => setEditing(true)}
            collapsed
          />
        </section>
      ) : null}
    </section>
  );
}

function TagGroupSection({
  group,
  selected,
  onToggle,
}: {
  group: BriefTagGroup;
  selected: Set<string>;
  onToggle: (slug: string) => void;
}) {
  const pickedInGroup = group.tags.filter((t) => selected.has(t.slug)).length;
  const overCap = pickedInGroup > group.suggestedMax;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Eyebrow>{group.label}</Eyebrow>
          <p className="mt-1 font-display text-h4 text-ink">{group.prompt}</p>
        </div>
        <p
          className={cn(
            'font-mono text-meta uppercase tracking-eyebrow',
            overCap ? 'text-clay' : 'text-ink-faint',
          )}
        >
          {pickedInGroup} / ~{group.suggestedMax}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {group.tags.map((tag) => {
          const isSelected = selected.has(tag.slug);
          return (
            <button
              key={tag.slug}
              type="button"
              onClick={() => onToggle(tag.slug)}
              aria-pressed={isSelected}
              title={tag.hint ?? undefined}
              className={cn(
                'rounded-pill border px-4 py-2 text-[13px] transition',
                isSelected
                  ? 'border-clay/50 bg-clay/15 text-ink shadow-sm'
                  : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink',
              )}
            >
              {tag.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BriefResponseCard({
  response,
  paletteById,
  styleBySlug,
  onEdit,
  collapsed = false,
}: {
  response: BriefSynthesis;
  paletteById: Map<string, BriefPaletteLookup>;
  styleBySlug: Map<string, BriefStyleLookup>;
  onEdit: () => void;
  collapsed?: boolean;
}) {
  const palette = paletteById.get(response.recommendation.palette_id);
  const style = styleBySlug.get(response.recommendation.style_slug);

  return (
    <article className="p-6 md:p-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Eyebrow>Designer note</Eyebrow>
          <p className="mt-2 font-display text-h3 text-ink">
            {collapsed ? 'Your brief direction.' : "Here's the read on your brief."}
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="rounded-pill border border-ink/15 px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink"
        >
          Edit your brief
        </button>
      </header>

      {/* WHAT YOU SAID */}
      <div className="mt-7 max-w-2xl">
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          What you said
        </p>
        <p className="mt-2 font-display text-[20px] leading-snug text-ink">
          {response.what_you_said}
        </p>
      </div>

      {/* RECOMMENDATION */}
      <div className="mt-10 rounded-xl border border-clay/30 bg-paper-warm bg-grain p-6">
        <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
          I'd recommend
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-5">
          {palette ? (
            <div className="flex items-center gap-4">
              <div className="w-44 shrink-0">
                <PaletteStrip colors={palette.swatch} className="h-8" />
              </div>
              <div>
                <p className="font-display text-h3 text-ink">{palette.name}</p>
                {style ? (
                  <p className="mt-1 font-display text-[15px] italic text-ink-soft">
                    with {style.name}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="font-display text-h3 text-ink">
              {response.recommendation.palette_id} · {response.recommendation.style_slug}
            </p>
          )}
        </div>
        <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink">
          {response.recommendation.reasoning}
        </p>
      </div>

      {/* PUSH BACK */}
      {response.push_back ? (
        <div className="mt-8 border-l-2 border-clay/40 pl-5">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-clay">
            One thing I'd push back on
          </p>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink">
            {response.push_back.concern}
          </p>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
            <span className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
              If you'd consider it →{' '}
            </span>
            {response.push_back.alternative.reasoning}
          </p>
        </div>
      ) : null}

      {/* ALSO CONSIDER */}
      {response.also_consider.length > 0 ? (
        <div className="mt-8">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            Also consider
          </p>
          <ul className="mt-3 space-y-3">
            {response.also_consider.map((alt, idx) => {
              const altPalette = paletteById.get(alt.palette_id);
              const altStyle = styleBySlug.get(alt.style_slug);
              return (
                <li key={idx} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="font-display text-h4 text-ink">
                    {altPalette?.name ?? alt.palette_id}
                    {altStyle ? (
                      <span className="font-display italic text-ink-soft"> · {altStyle.name}</span>
                    ) : null}
                  </p>
                  <p className="text-[14px] text-ink-soft">{alt.one_line_why}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* AVOID */}
      {response.avoid.length > 0 ? (
        <div className="mt-8">
          <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            I'd avoid
          </p>
          <ul className="mt-3 space-y-2">
            {response.avoid.map((a, idx) => {
              const avoidPalette = a.palette_id ? paletteById.get(a.palette_id) : null;
              const avoidStyle = a.style_slug ? styleBySlug.get(a.style_slug) : null;
              const label =
                avoidPalette?.name ??
                avoidStyle?.name ??
                a.palette_id ??
                a.style_slug ??
                'this direction';
              return (
                <li key={idx} className="flex gap-2">
                  <span className="font-mono text-[14px] text-ink-faint">×</span>
                  <p className="text-[14px] leading-relaxed text-ink">
                    <span className="font-display">{label}</span> — {a.reason}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="mt-10 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
        Generated {new Date(response.generated_at).toLocaleString('en-AU')}
      </p>
    </article>
  );
}
