// Hardcoded style catalogue for M1. Each entry seeds the render prompt and the
// style_profiles row so renders are reproducible. Palettes are sRGB hex.

export type StyleSlug =
  | 'coastal'
  | 'japandi'
  | 'hamptons'
  | 'mid-century'
  | 'industrial'
  | 'boho'
  | 'contemporary-au'
  | 'minimalist';

export interface HardcodedStyle {
  slug: StyleSlug;
  name: string;
  tagline: string;
  descriptor: string;
  palette: string[];
  materials: string[];
  mood: string[];
}

export const STYLES: HardcodedStyle[] = [
  {
    slug: 'coastal',
    name: 'Coastal',
    tagline: 'Whitewashed timber, linen, sea light',
    descriptor: 'relaxed Australian coastal interior with whitewashed timber, linen upholstery, woven rattan accents, soft blue and sand tones',
    palette: ['#F4EFE6', '#D7E2E0', '#A8B7B0', '#5C6E6B', '#1B1815'],
    materials: ['whitewashed oak', 'linen', 'rattan', 'jute', 'seagrass'],
    mood: ['breezy', 'sun-bleached', 'calm'],
  },
  {
    slug: 'japandi',
    name: 'Japandi',
    tagline: 'Warm minimalism, oak, paper, restraint',
    descriptor: 'warm Japandi interior blending Japanese minimalism and Scandinavian comfort, light oak, oat linen, paper lanterns, low furniture',
    palette: ['#F1ECE0', '#D9C7A7', '#8B7355', '#3A352E', '#1B1815'],
    materials: ['light oak', 'oat linen', 'rice paper', 'ceramic', 'matte black metal'],
    mood: ['calm', 'organic', 'considered'],
  },
  {
    slug: 'hamptons',
    name: 'Hamptons',
    tagline: 'Cream slipcovers, navy, polished brass',
    descriptor: 'classic Hamptons interior with cream slipcovered sofas, navy accents, polished brass, shaker panelling, herringbone floors',
    palette: ['#FBF8F2', '#E4DCC9', '#7A8FA8', '#1F3552', '#1B1815'],
    materials: ['linen slipcover', 'shiplap', 'polished brass', 'herringbone oak', 'glass'],
    mood: ['breezy', 'crisp', 'tailored'],
  },
  {
    slug: 'mid-century',
    name: 'Mid-Century',
    tagline: 'Walnut, tapered legs, mustard, teal',
    descriptor: 'mid-century modern interior with walnut timber, tapered legs, mustard and teal upholstery, geometric textiles, Eames-era silhouettes',
    palette: ['#F4EFE6', '#C9994A', '#3E5D5E', '#5C3A21', '#1B1815'],
    materials: ['walnut', 'bouclé', 'mustard wool', 'brass', 'smoked glass'],
    mood: ['warm', 'graphic', 'optimistic'],
  },
  {
    slug: 'industrial',
    name: 'Industrial',
    tagline: 'Blackened steel, brick, leather, raw timber',
    descriptor: 'urban industrial interior with blackened steel, exposed brick, raw oak floors, tan leather seating, edison filament lighting',
    palette: ['#2A2622', '#5C4A3A', '#A6824A', '#D5C9B6', '#1B1815'],
    materials: ['blackened steel', 'tan leather', 'reclaimed oak', 'exposed brick', 'concrete'],
    mood: ['raw', 'grounded', 'masculine'],
  },
  {
    slug: 'boho',
    name: 'Boho',
    tagline: 'Layered textiles, terracotta, rattan, plants',
    descriptor: 'bohemian interior with layered Berber rugs, terracotta pottery, rattan furniture, abundant plants, macramé wall hangings, warm earth tones',
    palette: ['#F2E6D2', '#D89A77', '#B7553C', '#5E6A4D', '#1B1815'],
    materials: ['rattan', 'terracotta', 'wool kilim', 'macramé', 'reclaimed timber'],
    mood: ['layered', 'warm', 'eclectic'],
  },
  {
    slug: 'contemporary-au',
    name: 'Contemporary AU',
    tagline: 'Pale oak, plaster walls, eucalypt notes',
    descriptor: 'contemporary Australian interior with pale oak floors, lime-washed plaster walls, sculptural travertine, eucalyptus green accents, soft natural light',
    palette: ['#F4EFE6', '#E8DECB', '#A89A82', '#5E6A4D', '#1B1815'],
    materials: ['pale oak', 'travertine', 'lime plaster', 'linen', 'matte ceramic'],
    mood: ['relaxed', 'modern', 'natural'],
  },
  {
    slug: 'minimalist',
    name: 'Minimalist',
    tagline: 'Negative space, mono tones, one statement',
    descriptor: 'minimalist interior with negative space, monochromatic palette, single sculptural statement piece, hidden storage, soft diffused light',
    palette: ['#FBF8F2', '#E8E4DD', '#9C988F', '#3A3733', '#1B1815'],
    materials: ['microcement', 'pale oak', 'matte plaster', 'brushed steel', 'opaque glass'],
    mood: ['quiet', 'precise', 'restrained'],
  },
];

export function getStyle(slug: string): HardcodedStyle | undefined {
  return STYLES.find((s) => s.slug === slug);
}

// Lightweight subset of RoomAnalysis (defined in lib/vision.ts) — duplicated
// here to avoid an import cycle for what would otherwise be a transitive type.
export interface RoomFacts {
  room_type?: string | null;
  architectural_features?: string[];
  light?: { direction?: string | null; quality?: string | null } | null;
  flooring?: string | null;
  existing_colours?: Array<{ surface: string; description: string }>;
}

// Bare minimum about a hero product that we can describe in a prompt. We
// don't pass the image — Flux can't see it without the redux variant — but
// we describe it textually so the generation biases toward similar items.
export interface HeroProductDescriptor {
  name: string;
  category: string;
  retailer: string;
}

// Render aggressiveness mode.
//   - 'subtle' = legacy behaviour. Flooring is preserved exactly, walls
//     hold their existing tone, the model only swaps upholstery + furniture.
//     Strength 0.70 in fal.ts. Use when the room geometry/lighting is too
//     unusual to risk transformation.
//   - 'bold'   = current default. Walls take palette colour, flooring swaps
//     to a palette-appropriate material, windows get curtains/sheers,
//     statement lighting is invited in. Strength 0.82. This is what drives
//     emotional attachment — the user sees their room as a *new* room.
export type PromptMode = 'subtle' | 'bold';

// Minimal palette shape we accept from /api/render. Avoids importing
// the full lib/palettes module just for a type alias.
export interface PromptPalette {
  name?: string;
  colors?: Array<{ hex: string; role?: string | null; name?: string | null }>;
}

export function buildPrompt(
  style: HardcodedStyle,
  facts?: RoomFacts | null,
  heroProducts?: HeroProductDescriptor[] | null,
  palette?: PromptPalette | null,
  mode: PromptMode = 'bold',
): string {
  // Use the USER'S selected palette if one was provided. Without this,
  // buildPrompt was only seeing the style's default palette — so when a
  // user picked "Warm Grounded Earth" on a Contemporary AU base, Flux
  // was told to use Contemporary AU's neutral palette anyway. The
  // walls then stayed cool grey. This was the single biggest reason
  // surface transformation scored 4/10 in the first eval run.
  const effectiveHexes: string[] =
    palette?.colors && palette.colors.length >= 3
      ? palette.colors.map((c) => c.hex)
      : style.palette;
  const paletteName = palette?.name ?? style.name;
  const wallTone = effectiveHexes[0];
  const accentTone = effectiveHexes[effectiveHexes.length - 1];

  // The architecture-preservation tokens at the end matter as much as the
  // style descriptor. Flux respects positive-language directives much better
  // than negative ones (it doesn't have classic negative prompts), so we ask
  // for what we want rather than listing what to avoid.
  const base = [
    style.descriptor,
    facts?.room_type ? `${factsRoomType(facts.room_type)}, fully restyled` : null,
    'photorealistic interior photography',
    'natural daylight, soft shadows',
    '35mm lens, architectural digest editorial',
    'tack-sharp detail, accurate scale',
  ].filter(Boolean) as string[];

  // STRONGEST wall directive — placed near the front and named with the
  // actual palette hex so Flux can't slide back to default neutral. The
  // previous "palette across walls" line was too weak; Claude evaluator
  // explicitly called out walls staying cool-grey despite a warm palette
  // being selected.
  if (wallTone) {
    base.push(
      `walls painted in ${wallTone} (${paletteName} dominant tone) — fully repaint EVERY wall including any panelling, board-and-batten, picture rails, accent walls. Walls must NOT remain white or off-white if the palette tone is not white`,
    );
  }

  // Full palette directive — secondary cue listing the rest of the
  // colour story so Flux applies it across fabric/decor/accents.
  if (effectiveHexes.length >= 3) {
    const palette = effectiveHexes.slice(0, 5).join(', ');
    base.push(
      `palette ${palette} (${paletteName}) — apply across soft furnishings, decor, accent surfaces`,
    );
  }
  if (accentTone && accentTone !== wallTone) {
    base.push(`accent tone ${accentTone} for cushions, art, decorative objects`);
  }

  if (facts) {
    // Geometry-preservation only. We never lock floor *material* or wall
    // *colour* — those need to transform with the chosen palette. We do lock
    // the room's bones so the user still recognises their space.
    const preserve: string[] = [];
    if (facts.architectural_features && facts.architectural_features.length > 0) {
      preserve.push(
        `keep existing ${facts.architectural_features.slice(0, 4).join(', ')} positions`,
      );
    }
    if (mode === 'subtle' && facts.flooring) {
      // Subtle mode is the only place we still hard-pin flooring.
      preserve.push(`retain ${facts.flooring} flooring`);
    }
    if (facts.light?.direction) {
      preserve.push(`maintain ${facts.light.direction}-facing light direction`);
    }
    if (preserve.length > 0) {
      base.push(preserve.join(', '));
    }
  }

  if (heroProducts && heroProducts.length > 0) {
    // Bias the generation toward these specific catalogue items by naming
    // them in the prompt. Flux doesn't know SKUs, but a descriptive token
    // string like "low-slung boucle sofa, walnut coffee table" pushes the
    // sampler in that direction.
    const featured = heroProducts
      .map((p) => describeProduct(p))
      .filter(Boolean)
      .join(', ');
    if (featured) base.push(`featuring ${featured}`);
  }

  // Room-bones lock. Geometry never moves. Critical directives go EARLY
  // and use imperative phrasing — Flux dilutes long directives that
  // come after many "soft" tokens, so we keep these terse.
  base.push(
    'identical room geometry to reference: same walls, same window openings, same door openings, same ceiling height, same camera angle',
  );
  // Anti-hallucination directives. Even at canny 0.65 + strength 0.80,
  // featureless areas (sky through glass, smooth ceilings) drift unless
  // we lock them explicitly. The first eval flagged ceiling vent +
  // exterior view drift as the top hallucinations.
  base.push(
    'CRITICAL: exterior view through every window stays IDENTICAL to reference — same sky, weather, time of day, vegetation, buildings, horizon, elevation. Do not invent landscapes, lawns, fences, or new outdoor scenes.',
  );
  base.push(
    'CRITICAL: ceiling stays IDENTICAL to reference — no added vents, fans, downlights, sprinklers, speakers, skylights, beams. Ceiling height stays the same — do not compress or alter ceiling proportions.',
  );

  if (mode === 'bold') {
    // Aggressive surface transformation. Each line below is a separate
    // directive that pushes Flux to actually USE the chosen palette across
    // every visible surface, not just retint upholstery.
    base.push(
      'apply palette tone to wall surfaces — soft tonal wash in lighter palette colours, optional accent wall in a deeper palette tone',
    );
    // Decorative wall features (panelling, wainscoting, mouldings,
    // brick) need explicit protection — Flux at strength 0.87 with
    // canny at 0.55 will flatten them into plain paint otherwise. We
    // ask for the structure to stay and the finish to update.
    if (
      facts?.architectural_features?.some((f) =>
        /(panel|wainscot|shiplap|board-and-batten|moulding|cornice|brick|stone|picture rail|dado)/i.test(f),
      )
    ) {
      base.push(
        'preserve any existing wall panelling, wainscoting, mouldings, picture rails, brick or stone feature walls — keep their physical structure exactly, only update their finish or paint colour to match the palette',
      );
    }
    base.push(
      'reflooring permitted to suit the aesthetic — wide oak boards, honed travertine, wool rug overlay, or herringbone parquet as appropriate',
    );
    base.push(
      'drape windows with linen sheers or palette-toned floor-length curtains, never bare',
    );
    base.push(
      'introduce statement lighting positioned for the room\'s natural light — pendant, floor lamp, sculptural table lamp, or wall sconces — and replace any existing wall lights, ceiling lights or sconces with palette-appropriate alternatives',
    );
    base.push(
      'wall art at eye-level, sculptural decor on surfaces, fresh plants and ceramic vessels',
    );
  }

  base.push(
    'replace existing upholstery, patterns, and furniture with new pieces in the requested aesthetic',
  );
  base.push('no patterned chintz, no floral upholstery unless requested');
  return base.join(', ');
}

// Strip retailer/marketing fluff from a product name → a generic descriptive
// phrase Flux can latch onto. "Westwood Bench with Storage" → "westwood bench
// with storage" (lower-case keeps it stylistic, not product-page-y).
function describeProduct(p: HeroProductDescriptor): string {
  const cleaned = p.name.replace(/\s*-\s*[^-]+$/g, '').toLowerCase();
  return cleaned;
}

function factsRoomType(raw: string): string {
  return raw.replace(/_/g, ' ').toLowerCase();
}
