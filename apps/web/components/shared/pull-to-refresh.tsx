'use client';

// Mobile pull-to-refresh (#172). Mounted globally from the root
// layout. Touch-only — disabled on coarse-pointer detection so a
// desktop trackpad accidentally swiping doesn't fire it.
//
// Behaviour:
//   - Only engages when window.scrollY === 0 (top of page) and the
//     user is pulling down (touchY moving up over time means down in
//     visual terms relative to start).
//   - Resistance: visual pull distance grows at ~50% of finger
//     distance so the indicator never races ahead of the gesture.
//   - Threshold: TRIGGER_PX. Past that, release fires router.refresh().
//   - Native iOS pull-to-refresh + overscroll glow disabled via the
//     overscroll-behavior-y rule on body (globals.css).
//
// Visual: a strip pinned to the top of the viewport that grows in
// height as the user pulls. Refresh glyph rotates as the pull
// passes the trigger; spins while refreshing; whole strip fades out
// when refresh completes.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/** Pixels of pull needed to commit a refresh on release. */
const TRIGGER_PX = 70;
/** Soft visual cap so the strip never grows comically tall. */
const MAX_PULL_PX = 140;
/** Resistance multiplier — visual distance vs raw finger distance. */
const RESISTANCE = 0.5;
/** Minimum finger distance before we start preventing native scroll. */
const ENGAGE_PX = 8;

export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Use a ref for the active gesture's start Y so we don't re-render
  // for every touchmove that doesn't change visual state.
  const startY = useRef<number | null>(null);
  // Tracks whether the current gesture has crossed the engage threshold;
  // we only preventDefault on touchmove once engaged so light flicks
  // still fall through to the browser's native scroll.
  const engaged = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Coarse pointer = touch device (phone / tablet). Skip on desktops
    // where trackpads have their own pull-to-refresh behaviour that
    // we don't want to intercept.
    const isTouch = window.matchMedia('(pointer: coarse)').matches;
    if (!isTouch) return;

    function reset() {
      startY.current = null;
      engaged.current = false;
    }

    function onTouchStart(e: TouchEvent) {
      // Only begin the gesture at the very top of the page.
      if (window.scrollY > 0) {
        reset();
        return;
      }
      if (refreshing) return;
      const t = e.touches[0];
      if (!t) return;
      startY.current = t.clientY;
      engaged.current = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null || refreshing) return;
      const t = e.touches[0];
      if (!t) return;
      const dy = t.clientY - startY.current;
      if (dy <= 0) {
        // Finger going UP → not a pull-down gesture. Drop visual.
        if (pullDistance !== 0) setPullDistance(0);
        return;
      }
      if (dy >= ENGAGE_PX) {
        engaged.current = true;
      }
      // Once engaged we preventDefault so iOS's native pull-to-refresh
      // + overscroll bounce don't double up on top of ours.
      if (engaged.current && e.cancelable) {
        e.preventDefault();
      }
      const distance = Math.min(MAX_PULL_PX, dy * RESISTANCE);
      setPullDistance(distance);
    }

    function onTouchEnd() {
      if (startY.current === null) {
        return;
      }
      const committed = pullDistance >= TRIGGER_PX;
      reset();
      if (committed) {
        setRefreshing(true);
        // Soft Next.js refresh — re-fetches all server components for
        // this route without losing client state. Same effect as F5
        // for our data needs but cheaper. If the page is purely
        // client-state we still get the spinner UX.
        router.refresh();
        // Hold the spinner for a short beat so the user perceives the
        // refresh actually happening, then snap the strip closed.
        // 600ms is roughly the time router.refresh() takes for a
        // typical server component round-trip.
        window.setTimeout(() => {
          setRefreshing(false);
          setPullDistance(0);
        }, 600);
      } else {
        setPullDistance(0);
      }
    }

    function onTouchCancel() {
      reset();
      setPullDistance(0);
    }

    // touchmove must be non-passive so preventDefault works. Start/
    // end are passive — cheaper for the browser scroll thread.
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [pullDistance, refreshing, router]);

  const ready = pullDistance >= TRIGGER_PX;
  // Hide the strip entirely when we're at rest — avoids the strip
  // taking up a 0-height-but-still-positioned spot in stacking order.
  const visible = pullDistance > 0 || refreshing;

  return (
    <>
      <div
        aria-hidden={!refreshing}
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex items-end justify-center overflow-hidden border-b border-editorial-border bg-editorial-cream/95 backdrop-blur"
        style={{
          height: refreshing ? `${TRIGGER_PX}px` : `${pullDistance}px`,
          opacity: visible ? 1 : 0,
          // Snap-back uses a quick ease; while finger is on screen we
          // skip the transition so the strip tracks the finger 1:1.
          transition:
            refreshing || pullDistance === 0
              ? 'height 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 200ms ease-out'
              : 'opacity 120ms ease-out',
        }}
      >
        <div className="flex flex-col items-center gap-1 pb-3">
          <RefreshGlyph spinning={refreshing} ready={ready} />
          <p className="font-dmmono text-[10px] uppercase tracking-eyebrow text-editorial-taupe">
            {refreshing ? 'Refreshing…' : ready ? 'Release to refresh' : 'Pull to refresh'}
          </p>
        </div>
      </div>
      {children}
    </>
  );
}

function RefreshGlyph({ spinning, ready }: { spinning: boolean; ready: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={
        'text-editorial-cognac transition-transform duration-200 ease-out ' +
        (spinning ? 'animate-spin' : ready ? 'rotate-180' : '')
      }
      aria-hidden
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
