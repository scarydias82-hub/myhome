'use client';

// AddToProjectButton (#130) — universal cart-style CTA for adding a
// product to a project's shortlist. Goes alongside the wishlist heart
// on every product surface: picking list MatchCard, complete-the-look
// CompactMatchCard, catalogue browser cards.
//
// Behaviour:
//   - 0 active projects  → "Create a project" link to /projects/new
//   - 1 active project   → click adds straight, shows "Added ✓"
//   - 2+ active projects → click opens a small modal; picking a row
//                          fires the POST then shows "Added ✓"
//
// Active = status in ('in_progress', 'in_review'). Completed and
// archived projects don't appear (per user requirement). The button
// pre-fetches the active list on mount so opening the modal is
// instant.
//
// State is local — added/not-added is "saved this click", not persisted
// look-up. A page reload resets the visual. That's intentional for
// v1 — the per-project shortlist lookups would otherwise need to fan
// out across every product card. Future enhancement: server-seed an
// `addedToProjectIds` set the same way we seed wishlist heart state.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

interface ActiveProject {
  id: string;
  name: string;
  status: string;
}

interface AddToProjectButtonProps {
  productId: string;
  /** Optional — keeps the button compact when surfaces are space-
   *  constrained (picking-list cards). Defaults to "comfortable". */
  variant?: 'comfortable' | 'compact';
}

type AddState = 'idle' | 'adding' | 'added' | 'duplicate';

export function AddToProjectButton({ productId, variant = 'comfortable' }: AddToProjectButtonProps) {
  const [projects, setProjects] = useState<ActiveProject[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addState, setAddState] = useState<AddState>('idle');
  const [addedToName, setAddedToName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-fetch on mount. Tiny payload, lets the modal open instantly.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/projects/active')
      .then((r) => r.json())
      .then((j: { projects?: ActiveProject[] }) => {
        if (cancelled) return;
        setProjects(j.projects ?? []);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addToProject(project: ActiveProject) {
    setAddState('adding');
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}/shortlist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'product', sourceId: productId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        alreadyShortlisted?: boolean;
      };
      if (!res.ok) {
        setAddState('idle');
        setError(json.error ?? 'Could not add to project.');
        return;
      }
      setAddedToName(project.name);
      setAddState(json.alreadyShortlisted ? 'duplicate' : 'added');
      setPickerOpen(false);
    } catch (err) {
      setAddState('idle');
      setError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  // Tap to do the right thing based on project count.
  function onTap() {
    if (!projects) return; // still loading
    if (projects.length === 0) return; // CTA below handles this
    if (projects.length === 1) {
      void addToProject(projects[0]!);
      return;
    }
    setPickerOpen(true);
  }

  // RENDER — zero projects: render an inline "create a project" link
  // so the user has a way forward rather than an inert button.
  if (projects && projects.length === 0) {
    return (
      <Link
        href="/projects/new"
        className={cn(
          'inline-flex items-center gap-2 rounded-pill border border-clay/30 bg-clay/5 px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow text-clay transition hover:border-clay/60 hover:bg-clay/10',
          variant === 'compact' && 'px-2.5 py-1 text-[10px]',
        )}
      >
        + Create a project
      </Link>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={onTap}
        disabled={!projects || addState === 'adding'}
        aria-label={
          addState === 'added' || addState === 'duplicate'
            ? `Added to ${addedToName ?? 'project'}`
            : 'Add to project'
        }
        className={cn(
          'inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 font-mono text-meta uppercase tracking-eyebrow transition',
          variant === 'compact' ? 'px-2.5 py-1 text-[10px]' : '',
          addState === 'added' || addState === 'duplicate'
            ? 'border-olive/40 bg-olive/10 text-olive'
            : 'border-ink/15 bg-cream text-ink-soft hover:border-ink/30 hover:text-ink',
          (!projects || addState === 'adding') && 'opacity-60',
        )}
      >
        {addState === 'adding'
          ? '+ Adding…'
          : addState === 'added'
            ? `✓ Added${addedToName ? ` · ${addedToName}` : ''}`
            : addState === 'duplicate'
              ? `Already in ${addedToName ?? 'project'}`
              : '+ Add to project'}
      </button>

      {error ? (
        <p className="mt-1 font-mono text-[10px] uppercase tracking-eyebrow text-destructive">{error}</p>
      ) : null}

      {pickerOpen && projects && projects.length > 1 ? (
        <PickerModal
          projects={projects}
          onPick={(p) => void addToProject(p)}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </>
  );
}

function PickerModal({
  projects,
  onPick,
  onClose,
}: {
  projects: ActiveProject[];
  onPick: (project: ActiveProject) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-project-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-ink/[0.06] bg-cream p-6 shadow-soft">
        <p
          id="add-to-project-title"
          className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint"
        >
          Add to project
        </p>
        <p className="mt-2 font-display text-h3 text-ink">Which project?</p>
        <p className="mt-2 text-[13px] text-ink-soft">
          Pick the project you'd like to add this product to. Completed projects
          don't appear here.
        </p>
        <ul className="mt-5 space-y-2">
          {projects.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p)}
                className="w-full rounded-xl border border-ink/[0.06] bg-paper-warm bg-grain p-4 text-left transition hover:border-clay/30 hover:bg-cream"
              >
                <p className="font-display text-h4 text-ink">{p.name}</p>
                <p className="mt-1 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
                  {p.status.replace(/_/g, ' ')}
                </p>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-ink/15 px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-ink-soft transition hover:border-ink/30 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
