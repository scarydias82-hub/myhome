// Pre-filter step (#156) — narrows a palette-matched candidate pool by
// scoring each product's `vision_profile` JSON against the user's
// preference tags before Claude curation runs (and inside the no-Claude
// fallback path too). Closes the gap where user preferences only
// steered Claude's prompt but never touched the candidate set itself —
// meaning a user who picked "avoid:cool-metals" could still be shown a
// chrome floor lamp if its palette_tags matched.
//
// Deterministic — no extra LLM call. The mapping below translates each
// BRIEF_TAG_GROUPS slug into the vision_profile signals it implies
// (materials / visual_tone / color_family / quality_tier), built from
// the exact enum vocabulary the scraper's visionProfile.js asks Claude
// for at catalogue-ingestion time. Re-derive this map if either
// taxonomy moves; both vocabularies are checked in.
//
// Scoring weights:
//   - materials direct hit:           +2  (strongest signal)
//   - mood → visual_tone match:        +1
//   - color_family match:              +1
//   - quality_tier match:              +1
//   - AVOID hit on materials/tone/colour: -3 (heavier than any single positive
//                                          so an unmitigated avoid drops)
//
// Drop threshold: score < -2 → drop the candidate entirely. That
// equates to "at least one avoid hit with no positives offsetting it".
// Survivors are returned sorted by score desc so the most-preferred
// candidates lead the Claude curation prompt (Claude reads top-down).

export interface VisionProfile {
  silhouette?: string;
  materials?: string[];
  color_family?: string | null;
  visual_tone?: string | null;
  quality_tier?: string | null;
  palette_fit?: Record<string, number>;
  room_fit?: Record<string, number>;
  // Stage 3b additions (PR #77, 2026-05-27). All optional because
  // existing rows pre-PR-#77 don't have them populated. Mode C's
  // IP-Adapter logic (Stage 3b) will fall back gracefully when any
  // field is missing; prefs-vision-fit scorer ignores them entirely
  // (those signals don't map to user-taste tags).
  /** Camera angle on the product image. "three_quarter" / "front" are
   *  the IP-Adapter sweet spot; "lifestyle" is intentionally avoided
   *  as a reference because surrounding context bleeds into renders. */
  dominant_view_angle?:
    | 'front'
    | 'three_quarter'
    | 'side'
    | 'top_down'
    | 'lifestyle'
    | null;
  /** Surface character independent of material — matte vs glossy vs
   *  textured. Drives how SDXL renders specular highlights. */
  material_finish?: 'matte' | 'semi_gloss' | 'glossy' | 'textured' | 'mixed' | null;
  /** How the piece meets the floor. Useful for room composition
   *  (legs_visible pieces float; skirted/platform pieces ground). */
  base_type?:
    | 'legs_visible'
    | 'skirted'
    | 'platform'
    | 'wall_mounted'
    | 'floor_resting'
    | 'n/a'
    | null;
  /** Style coherence anchors. 1-3 tags ordered most-to-least defining. */
  style_tags?: string[];
  /** Seating-only: arm shape. Absent on non-seating products. */
  arm_style?: 'rolled' | 'track' | 'square' | 'armless' | 'curved' | 'n/a';
  /** Seating-only: cushion treatment. Absent on non-seating products. */
  cushion_type?: 'loose' | 'tight' | 'tufted' | 'channel' | 'smooth' | 'n/a';
}

interface SignalMap {
  materials?: string[];
  visual_tone?: string[];
  color_family?: string[];
  quality_tier?: string[];
}

// Slug → vision_profile signals the slug implies. Source taxonomy:
// `lib/brief/taxonomy.ts` (BRIEF_TAG_GROUPS). Target enums: defined
// inline in `apps/scraper/scripts/visionProfile.js` (materials list +
// color_family + visual_tone + quality_tier enums). When either side
// changes, update this map.
const POSITIVE_SIGNALS: Record<string, SignalMap> = {
  // Materials category — direct slug→materials map. Some user-facing
  // labels span multiple catalogue materials (linen-and-cotton is one
  // chip but the scraper records each separately).
  'materials:warm-oak': { materials: ['oak'] },
  'materials:dark-walnut': { materials: ['walnut'] },
  'materials:travertine': { materials: ['travertine'] },
  'materials:marble': { materials: ['marble'] },
  'materials:linen': { materials: ['linen', 'cotton'] },
  'materials:boucle-wool': { materials: ['boucle', 'wool'] },
  'materials:leather': { materials: ['leather'] },
  'materials:brass-bronze': { materials: ['brass'] },
  // "Matte black metal" doesn't have an exact scraper material; we
  // approximate via steel (most common matte-black-metal substrate) +
  // a moody visual_tone hint.
  'materials:matte-black-metal': { materials: ['steel'], visual_tone: ['moody'] },
  'materials:ceramic-clay': { materials: ['ceramic'] },
  'materials:rattan-cane': { materials: ['rattan', 'cane', 'woven'] },
  'materials:glass-mirror': { materials: ['glass'] },

  // Mood category — maps to visual_tone. Each mood label has 1-2
  // tones that read most cleanly from the photo; we boost matches
  // against any of them.
  'mood:calm': { visual_tone: ['soft', 'quiet'] },
  'mood:dramatic': { visual_tone: ['bold', 'moody'] },
  'mood:sophisticated': { visual_tone: ['quiet', 'moody'] },
  'mood:playful': { visual_tone: ['bold', 'fresh'] },
  'mood:cocooning': { visual_tone: ['soft', 'warm'] },
  'mood:formal': { visual_tone: ['quiet'] },
  'mood:creative': { visual_tone: ['bold'] },
  'mood:understated': { visual_tone: ['soft', 'quiet'] },
  'mood:statement': { visual_tone: ['bold', 'moody'] },
  'mood:energising': { visual_tone: ['bold', 'fresh'] },

  // Constraints / horizon — both map to quality_tier honesty.
  'constraints:budget-conscious': { quality_tier: ['budget', 'mid'] },
  'constraints:premium-quality': { quality_tier: ['premium'] },
  'horizon:long-term-investment': { quality_tier: ['premium', 'mid'] },
};

// Avoid signals — when a user's tag explicitly negates a vision_profile
// attribute, apply a heavy penalty. Only avoid tags that have a clean
// vision_profile correlate are listed; abstract avoid slugs (`trendy`,
// `traditional`, `fussy-patterns`) are left out because they don't
// project cleanly onto a single enum and we'd rather let Claude reason
// about them than drop a candidate on a fuzzy match.
const NEGATIVE_SIGNALS: Record<string, SignalMap> = {
  'avoid:cool-greys': { color_family: ['cool-neutral'] },
  'avoid:cold-metals': { materials: ['chrome', 'steel'] },
  'avoid:loud-colours': { color_family: ['vibrant', 'jewel'], visual_tone: ['bold'] },
  'avoid:glossy-finishes': { materials: ['lacquer'] },
  // 'avoid:dark-walls', 'avoid:all-white' — about the room palette,
  //   not individual products. Surfaced upstream via palette choice.
  // 'avoid:fluorescent' — applies to lighting fixtures; can't infer
  //   from vision_profile.color_family alone (would over-fire). Leave
  //   to Claude curation.
};

const POSITIVE_WEIGHTS = { materials: 2, visual_tone: 1, color_family: 1, quality_tier: 1 } as const;
const NEGATIVE_WEIGHT = 3; // applied per axis hit
const DEFAULT_DROP_THRESHOLD = -2;

export interface PrefsFitScore {
  score: number;
  /** Slug → short reason (e.g. "materials:warm-oak +2 (matched oak)"). */
  positiveHits: string[];
  negativeHits: string[];
}

/** Score one product's vision_profile against a set of user pref tags. */
export function scorePrefsVisionFit(
  vp: VisionProfile | null | undefined,
  prefTags: string[],
): PrefsFitScore {
  const result: PrefsFitScore = { score: 0, positiveHits: [], negativeHits: [] };
  if (!vp || prefTags.length === 0) return result;

  const productMaterials = new Set((vp.materials ?? []).map((m) => m.toLowerCase()));
  const productTone = vp.visual_tone?.toLowerCase() ?? null;
  const productColour = vp.color_family?.toLowerCase() ?? null;
  const productTier = vp.quality_tier?.toLowerCase() ?? null;

  for (const slug of prefTags) {
    const pos = POSITIVE_SIGNALS[slug];
    if (pos) {
      if (pos.materials) {
        const hit = pos.materials.find((m) => productMaterials.has(m.toLowerCase()));
        if (hit) {
          result.score += POSITIVE_WEIGHTS.materials;
          result.positiveHits.push(`${slug} +${POSITIVE_WEIGHTS.materials} (materials includes "${hit}")`);
        }
      }
      if (pos.visual_tone && productTone && pos.visual_tone.includes(productTone)) {
        result.score += POSITIVE_WEIGHTS.visual_tone;
        result.positiveHits.push(`${slug} +${POSITIVE_WEIGHTS.visual_tone} (tone "${productTone}")`);
      }
      if (pos.color_family && productColour && pos.color_family.includes(productColour)) {
        result.score += POSITIVE_WEIGHTS.color_family;
        result.positiveHits.push(`${slug} +${POSITIVE_WEIGHTS.color_family} (colour "${productColour}")`);
      }
      if (pos.quality_tier && productTier && pos.quality_tier.includes(productTier)) {
        result.score += POSITIVE_WEIGHTS.quality_tier;
        result.positiveHits.push(`${slug} +${POSITIVE_WEIGHTS.quality_tier} (tier "${productTier}")`);
      }
    }

    const neg = NEGATIVE_SIGNALS[slug];
    if (neg) {
      if (neg.materials) {
        const hit = neg.materials.find((m) => productMaterials.has(m.toLowerCase()));
        if (hit) {
          result.score -= NEGATIVE_WEIGHT;
          result.negativeHits.push(`${slug} -${NEGATIVE_WEIGHT} (materials includes "${hit}")`);
        }
      }
      if (neg.visual_tone && productTone && neg.visual_tone.includes(productTone)) {
        result.score -= NEGATIVE_WEIGHT;
        result.negativeHits.push(`${slug} -${NEGATIVE_WEIGHT} (tone "${productTone}")`);
      }
      if (neg.color_family && productColour && neg.color_family.includes(productColour)) {
        result.score -= NEGATIVE_WEIGHT;
        result.negativeHits.push(`${slug} -${NEGATIVE_WEIGHT} (colour "${productColour}")`);
      }
    }
  }

  return result;
}

/**
 * Rank candidates by preferences-vision fit. Drops products whose score
 * falls below `dropThreshold` (default −2 ≈ "one unmitigated avoid hit").
 *
 * No-op (returns input unchanged) when `prefTags` is empty.
 *
 * Generic over the candidate row shape so this can wrap either the
 * autoFeatureClaude bucket map or the autoFeatureForPalette flat list.
 * The only constraint is the candidate carries `vision_profile`.
 */
export function rankCandidatesByPrefs<T extends { vision_profile?: VisionProfile | null }>(
  candidates: T[],
  prefTags: string[],
  options: { dropThreshold?: number } = {},
): { ranked: T[]; dropped: number; topScore: number } {
  if (prefTags.length === 0) {
    return { ranked: candidates, dropped: 0, topScore: 0 };
  }
  const dropThreshold = options.dropThreshold ?? DEFAULT_DROP_THRESHOLD;

  const scored = candidates.map((c) => ({
    candidate: c,
    fit: scorePrefsVisionFit(c.vision_profile, prefTags),
  }));
  const survivors = scored.filter((s) => s.fit.score >= dropThreshold);
  survivors.sort((a, b) => b.fit.score - a.fit.score);

  return {
    ranked: survivors.map((s) => s.candidate),
    dropped: candidates.length - survivors.length,
    topScore: survivors[0]?.fit.score ?? 0,
  };
}
