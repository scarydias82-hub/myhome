// myMaison Whisper mark — the layered mM monogram.
//
// Foreground: italic-taupe m + roman-espresso M
// Background echo: 18% opacity cognac, offset +3px right / +4px down at 100px.
// The echo represents the idea behind the realisation — inspiration becoming
// a finished space. It MUST always render as crisp vector.
//
// Per brand guidelines: never reverse the echo direction, never use any other
// colour for the echo, never apply gradients or drop shadows. Below 32px the
// echo collapses to mud — use ?withEcho={false} or omit it for favicons.

import { cn } from '@/lib/utils';

interface WhisperMarkProps {
  size?: number; // pixels (default 64)
  withEcho?: boolean; // default true; set false for favicons/<32px
  dark?: boolean; // dark-mode variant (espresso background)
  className?: string;
  ariaLabel?: string;
}

export function WhisperMark({
  size = 64,
  withEcho = true,
  dark = false,
  className,
  ariaLabel = 'myMaison',
}: WhisperMarkProps) {
  // Offset scales linearly with size. At 100px: +3 right, +4 down.
  const offsetX = (3 / 100) * size;
  const offsetY = (4 / 100) * size;

  const fgM = dark ? '#C4956A' : '#8B7355'; // italic m
  const fgB = dark ? '#F5EFE6' : '#2C1F14'; // roman M
  const echoFill = '#C4956A';
  const echoOpacity = dark ? 0.4 : 0.18;

  // Use viewBox so it scales cleanly; the typography is rendered with SVG
  // text using Playfair Display — must be loaded via next/font (already wired
  // up in app/layout.tsx as --font-serif).
  const baselineY = size * 0.78;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(className)}
      style={{ overflow: 'visible' }}
    >
      {withEcho ? (
        <g fill={echoFill} opacity={echoOpacity} style={{ fontFamily: 'var(--font-serif), Playfair Display, Georgia, serif' }}>
          <text
            x={offsetX}
            y={baselineY + offsetY}
            fontSize={size * 0.85}
            fontStyle="italic"
            fontWeight={400}
          >
            m
          </text>
          <text
            x={size * 0.42 + offsetX}
            y={baselineY + offsetY}
            fontSize={size * 0.85}
            fontWeight={500}
          >
            M
          </text>
        </g>
      ) : null}
      <g style={{ fontFamily: 'var(--font-serif), Playfair Display, Georgia, serif' }}>
        <text
          x={0}
          y={baselineY}
          fontSize={size * 0.85}
          fontStyle="italic"
          fontWeight={400}
          fill={fgM}
        >
          m
        </text>
        <text
          x={size * 0.42}
          y={baselineY}
          fontSize={size * 0.85}
          fontWeight={500}
          fill={fgB}
        >
          M
        </text>
      </g>
    </svg>
  );
}
