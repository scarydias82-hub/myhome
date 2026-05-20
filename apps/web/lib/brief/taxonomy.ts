// Consumer brief tag taxonomy.
//
// The brief is the user's primary input into a project — what they want,
// how they live, what they react against. The Claude synthesiser
// (lib/brief/synthesiser.ts) consumes these tags and recommends a
// palette + style direction with reasoning, agreement, push-back, and
// avoid warnings. Strictly bounded to ~65 tags across 7 categories so
// the user can complete the brief in a few minutes without analysis
// paralysis.
//
// Tag slugs are kebab-case and prefixed with their category for
// readability in logs and prompts (e.g. `lifestyle:family-with-kids`,
// `avoid:cool-greys`). The category prefix also lets the synthesiser
// reason about category-level patterns (e.g. "they picked 4 'avoid'
// tags — they have strong negatives, lean conservative").

export type BriefTagCategory =
  | 'lifestyle'
  | 'mood'
  | 'materials'
  | 'look'
  | 'constraints'
  | 'avoid'
  | 'horizon';

export interface BriefTag {
  /** Stable slug; what gets persisted on projects.brief.tags. */
  slug: string;
  /** Display label. Sentence case. */
  label: string;
  /** Short helper text for the picker UI tooltip / sub-line. */
  hint?: string;
}

export interface BriefTagGroup {
  category: BriefTagCategory;
  label: string;
  /** Human-readable intro for the picker UI. */
  prompt: string;
  /** Soft cap on how many tags the user should pick in this group.
   *  The picker UI dims further selections past this, but doesn't block. */
  suggestedMax: number;
  tags: BriefTag[];
}

export const BRIEF_TAG_GROUPS: BriefTagGroup[] = [
  {
    category: 'lifestyle',
    label: 'Lifestyle',
    prompt: 'How do you actually live in this space?',
    suggestedMax: 4,
    tags: [
      { slug: 'lifestyle:family-with-kids', label: 'Family with kids' },
      { slug: 'lifestyle:work-from-home', label: 'Work from home', hint: 'A defined workspace matters' },
      { slug: 'lifestyle:entertain-often', label: 'Entertain often' },
      { slug: 'lifestyle:pets-in-the-home', label: 'Pets at home' },
      { slug: 'lifestyle:ageing-in-place', label: 'Ageing in place' },
      { slug: 'lifestyle:downsizing', label: 'Downsizing' },
      { slug: 'lifestyle:shared-household', label: 'Shared household', hint: 'Couples, housemates' },
      { slug: 'lifestyle:single-person', label: 'Single-person home' },
    ],
  },
  {
    category: 'mood',
    label: 'Mood',
    prompt: 'How should the room feel when you walk in?',
    suggestedMax: 3,
    tags: [
      { slug: 'mood:calm', label: 'Calm and restorative' },
      { slug: 'mood:energising', label: 'Energising' },
      { slug: 'mood:dramatic', label: 'Dramatic' },
      { slug: 'mood:cocooning', label: 'Cocooning' },
      { slug: 'mood:sophisticated', label: 'Sophisticated' },
      { slug: 'mood:playful', label: 'Playful' },
      { slug: 'mood:formal', label: 'Formal' },
      { slug: 'mood:creative', label: 'Creative and expressive' },
      { slug: 'mood:understated', label: 'Understated' },
      { slug: 'mood:statement', label: 'Statement-making' },
    ],
  },
  {
    category: 'materials',
    label: 'Materials I like',
    prompt: 'What surfaces and textures pull you in?',
    suggestedMax: 5,
    tags: [
      { slug: 'materials:warm-oak', label: 'Warm oak timber' },
      { slug: 'materials:dark-walnut', label: 'Dark walnut timber' },
      { slug: 'materials:travertine', label: 'Travertine / honed stone' },
      { slug: 'materials:marble', label: 'Marble' },
      { slug: 'materials:linen', label: 'Linen and cotton' },
      { slug: 'materials:boucle-wool', label: 'Bouclé and wool' },
      { slug: 'materials:leather', label: 'Leather' },
      { slug: 'materials:brass-bronze', label: 'Brass and bronze' },
      { slug: 'materials:matte-black-metal', label: 'Matte black metal' },
      { slug: 'materials:ceramic-clay', label: 'Ceramic and clay' },
      { slug: 'materials:rattan-cane', label: 'Rattan and cane' },
      { slug: 'materials:glass-mirror', label: 'Glass and mirror' },
    ],
  },
  {
    category: 'look',
    label: 'Looks I gravitate to',
    prompt: 'If you scrolled Pinterest, what would you save?',
    suggestedMax: 3,
    tags: [
      { slug: 'look:coastal', label: 'Coastal — sun-bleached, breezy' },
      { slug: 'look:japandi', label: 'Japandi — warm minimal' },
      { slug: 'look:contemporary-au', label: 'Contemporary Australian' },
      { slug: 'look:hamptons', label: 'Hamptons — classic, tailored' },
      { slug: 'look:mid-century', label: 'Mid-century modern' },
      { slug: 'look:industrial', label: 'Industrial — raw, grounded' },
      { slug: 'look:boho', label: 'Boho — layered, eclectic' },
      { slug: 'look:minimalist', label: 'Minimalist' },
      { slug: 'look:art-deco', label: 'Art Deco' },
      { slug: 'look:maximalist', label: 'Maximalist' },
    ],
  },
  {
    category: 'constraints',
    label: 'Practical constraints',
    prompt: 'What does the look have to work around?',
    suggestedMax: 4,
    tags: [
      { slug: 'constraints:budget-conscious', label: 'Budget-conscious' },
      { slug: 'constraints:premium-quality', label: 'Premium / investment pieces' },
      { slug: 'constraints:durable', label: 'Hard-wearing' },
      { slug: 'constraints:easy-clean', label: 'Easy to clean' },
      { slug: 'constraints:allergy-aware', label: 'Allergy-aware', hint: 'Low-pile, washable fabrics' },
      { slug: 'constraints:rental-friendly', label: 'Rental — nothing permanent' },
      { slug: 'constraints:kid-proof', label: 'Kid-proof' },
      { slug: 'constraints:pet-proof', label: 'Pet-proof' },
      { slug: 'constraints:small-space', label: 'Small space' },
      { slug: 'constraints:high-ceilings', label: 'High ceilings' },
    ],
  },
  {
    category: 'avoid',
    label: 'Things to avoid',
    prompt: 'What turns you off in someone else’s home?',
    suggestedMax: 5,
    tags: [
      { slug: 'avoid:cool-greys', label: 'Cool greys' },
      { slug: 'avoid:dark-walls', label: 'Dark walls' },
      { slug: 'avoid:loud-colours', label: 'Loud colours' },
      { slug: 'avoid:trendy', label: 'Anything too trendy' },
      { slug: 'avoid:cold-metals', label: 'Chrome and cold metals' },
      { slug: 'avoid:fussy-patterns', label: 'Fussy patterns' },
      { slug: 'avoid:glossy-finishes', label: 'Glossy finishes' },
      { slug: 'avoid:fluorescent', label: 'Fluorescent / cold lighting' },
      { slug: 'avoid:all-white', label: 'All-white interiors' },
      { slug: 'avoid:traditional', label: 'Traditional / period' },
    ],
  },
  {
    category: 'horizon',
    label: 'Time horizon',
    prompt: 'How long do you need this to last?',
    suggestedMax: 1,
    tags: [
      { slug: 'horizon:just-moved-in', label: 'Just moved in — set up fast' },
      { slug: 'horizon:live-with-it-first', label: 'Live with it first, decide later' },
      { slug: 'horizon:renovating-soon', label: 'Renovating in 12 months' },
      { slug: 'horizon:long-term-investment', label: 'Long-term — invest properly' },
      { slug: 'horizon:styling-for-resale', label: 'Styling for resale' },
    ],
  },
];

// Flat lookup — slug → tag. Used by the synthesiser to expand slugs
// into prompt-friendly labels, and by the API endpoint to validate
// incoming arrays against the known set.
export const TAG_BY_SLUG: Map<string, BriefTag & { category: BriefTagCategory }> = new Map();
for (const group of BRIEF_TAG_GROUPS) {
  for (const tag of group.tags) {
    TAG_BY_SLUG.set(tag.slug, { ...tag, category: group.category });
  }
}

/** Reject unknown slugs at the API boundary; tolerate a small drift
 *  so renaming a tag doesn't break previously-saved briefs (we just
 *  drop the unrecognised slug rather than 400 the whole save). */
export function filterKnownTags(slugs: string[] | null | undefined): string[] {
  if (!Array.isArray(slugs)) return [];
  return slugs.filter((s) => typeof s === 'string' && TAG_BY_SLUG.has(s));
}

/** Tag-fit utility — bucket the saved tags by category so the
 *  synthesiser can reason about category-level patterns. */
export function groupTagsByCategory(slugs: string[]): Record<BriefTagCategory, string[]> {
  const out: Record<BriefTagCategory, string[]> = {
    lifestyle: [],
    mood: [],
    materials: [],
    look: [],
    constraints: [],
    avoid: [],
    horizon: [],
  };
  for (const slug of slugs) {
    const tag = TAG_BY_SLUG.get(slug);
    if (tag) out[tag.category].push(slug);
  }
  return out;
}

/** Used in prompts: convert a tag slug to its human label. */
export function labelForSlug(slug: string): string {
  return TAG_BY_SLUG.get(slug)?.label ?? slug;
}
