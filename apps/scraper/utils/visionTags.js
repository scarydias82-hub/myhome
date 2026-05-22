// Derive the tag columns (palette_tags / room_tags / style_tags /
// mood_tags) from a product's vision_profile (#148).
//
// Shared by:
//   - apps/scraper/scripts/redeRiveTagsFromVisionProfile.js — one-shot
//     pass over rows that already have vision_profile from earlier runs.
//   - apps/scraper/scripts/visionProfile.js — folds the derivation into
//     the same UPDATE that writes vision_profile so future runs keep the
//     tag columns and the source-of-truth field in lock-step.
//
// Rule:
//   palette_tags  ← keys of vision_profile.palette_fit where score >= 0.4
//                   ("could work as an accent" floor — same gate Claude
//                   already uses to include a palette in palette_fit at all)
//   room_tags     ← keys of vision_profile.room_fit where score >= 0.4
//                   Vision-grounded (per-product Claude judgement),
//                   intentionally NOT the palette-union approach
//                   deriveTags() would give us via recommended_rooms —
//                   we want the per-image signal.
//   style_tags    ← union of style_tags from each palette in palette_tags
//                   (productTags.deriveTags handles this — palette-union
//                   is correct for style because style is a property of
//                   the palette family, not the individual product).
//   mood_tags     ← same union pattern from each palette's vibe tokens.
//
// Returns null when vision_profile is missing or unusable — caller
// decides whether to write empty arrays or leave the row alone.

import { deriveTags } from './productTags.js';

const FIT_THRESHOLD = 0.4;

export function tagsFromVisionProfile(visionProfile, category) {
  if (!visionProfile || typeof visionProfile !== 'object') return null;

  const paletteFit = visionProfile.palette_fit;
  const roomFit = visionProfile.room_fit;
  if (!paletteFit || typeof paletteFit !== 'object') return null;

  const palette_tags = Object.entries(paletteFit)
    .filter(([, s]) => typeof s === 'number' && s >= FIT_THRESHOLD)
    .map(([id]) => id)
    .sort();

  const room_tags = roomFit && typeof roomFit === 'object'
    ? Object.entries(roomFit)
        .filter(([, s]) => typeof s === 'number' && s >= FIT_THRESHOLD)
        .map(([id]) => id)
        .sort()
    : [];

  // style + mood ride on top of the vision-grounded palette set.
  // deriveTags() also returns its own room_tags (palette.recommended_rooms
  // ∪ categoryRooms) but we discard that — vision_profile.room_fit is the
  // per-product judgement we trust over the palette-union shortcut.
  const derived = deriveTags({ paletteTags: palette_tags, category });

  return {
    palette_tags,
    room_tags,
    style_tags: derived.style_tags,
    mood_tags: derived.mood_tags,
  };
}

export const VISION_FIT_THRESHOLD = FIT_THRESHOLD;
