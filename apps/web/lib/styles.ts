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
  vibe?: string;
  colors?: Array<{ hex: string; role?: string | null; name?: string | null }>;
}

// Map palette name → a temperature descriptor Flux understands as a
// single token anchor ("warm earth-toned", "cool airy"). Flux pays
// heavy attention to these umbrella adjectives early in the prompt —
// they shape the sampler's colour distribution more than a list of
// hex codes or palette names ever will.
function temperatureDescriptor(palette: PromptPalette): string {
  const name = (palette.name ?? '').toLowerCase();
  if (/warm|earth|mahogany|terra|cognac|clay|umber|tomato|red/.test(name)) return 'warm earth-toned';
  if (/teal|blue|misty|coastal|mint|sea/.test(name)) return 'cool airy coastal';
  if (/green|moss|ochre|pistachio|sage/.test(name)) return 'warm botanical';
  return 'warm neutral'; // honest-essentials, silhouette-and-pale, etc.
}

// Enriched colour vocab per palette family. Round 3 wall directive
// said "wheat tones" + "NO cool grey, NO blue-grey, NO white" — Flux
// went green/sage anyway because (a) "wheat" alone can read as
// wheat-field plant rather than wheat-the-colour, and (b) our negative
// list didn't mention green so the model thought sage was a valid
// "warm earth" interpretation. Round 4 fix: layer multiple concrete
// colour synonyms for the positive vocab, and extend negatives to
// cover the actual observed failure mode (sage / green / khaki for
// warm palettes; warm tones for cool palettes; etc.).
function paletteWallVocab(palette: PromptPalette): { positive: string; negative: string } {
  const name = (palette.name ?? '').toLowerCase();
  const wall = palette.colors?.find((c) => c.role === 'wall');
  const wallName = wall?.name?.toLowerCase() ?? 'palette wall tone';

  if (/warm[-\s]grounded|honest|mahogany|tomato|silhouette/.test(name)) {
    return {
      positive: `warm ${wallName}, biscuit, cream, clay and oat tones — a soft warm beige`,
      negative:
        'NO cool grey walls. NO blue-grey. NO white walls. NO green. NO sage. NO mint. NO khaki. NO olive',
    };
  }
  if (/teal|misty[-\s]blue|coastal|mint|sea[-\s]breeze|pale[-\s]mint/.test(name)) {
    return {
      positive: `cool ${wallName}, soft dove, airy pale tones`,
      negative:
        'NO warm beige walls. NO peach. NO terracotta. NO ochre. NO yellow walls. NO sage',
    };
  }
  if (/moss|ochre|pistachio/.test(name)) {
    return {
      positive: `soft ${wallName}, muted herb, dried-grass and stone tones`,
      negative: 'NO bright pink walls. NO purple. NO neon. NO cool grey',
    };
  }
  // Fallback for unrecognised palettes — still better than just the name.
  return {
    positive: `${wallName} tones`,
    negative: 'NO cool grey, NO blue-grey, NO white walls if the palette tone is not white',
  };
}

function describeWall(palette: PromptPalette): string | null {
  const wall = palette.colors?.find((c) => c.role === 'wall');
  const wallName = wall?.name?.toLowerCase();
  if (!wallName) return null;
  const vocab = paletteWallVocab(palette);
  return (
    `walls painted in ${vocab.positive} — fully repaint EVERY wall surface ` +
    `including any panelling, board-and-batten, picture rails or accent walls. ` +
    `The walls MUST take on the ${wallName} tone. ${vocab.negative}.`
  );
}

// Role-aware furniture / finish directive. Uses named colours like
// "caramel upholstery, walnut timber floor, cognac leather accents" —
// concrete vocab Flux can paint with, not opaque hex strings.
function describeRoles(palette: PromptPalette): string | null {
  if (!palette.colors || palette.colors.length === 0) return null;
  const role = (r: string) => palette.colors!.find((c) => c.role === r);
  const parts: string[] = [];
  const sofa = role('sofa');
  const floor = role('floor');
  const accent = role('accent');
  const trim = role('trim');
  if (sofa?.name) parts.push(`${sofa.name.toLowerCase()} upholstery`);
  if (floor?.name) parts.push(`${floor.name.toLowerCase()} timber flooring`);
  if (accent?.name) parts.push(`${accent.name.toLowerCase()} leather and metal accents`);
  if (trim?.name) parts.push(`${trim.name.toLowerCase()} trim and hardware`);
  if (parts.length === 0) return null;
  return parts.join(', ') + ' — apply across furniture, bedding, art and decor';
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
  const paletteName = palette?.name ?? style.name;
  const promptPalette: PromptPalette = palette ?? {
    name: style.name,
    colors: style.palette.map((hex) => ({ hex, role: null, name: null })),
  };

  // Architecture-preservation tokens at the end matter as much as the
  // style descriptor. Flux respects positive-language directives much
  // better than negative ones (it doesn't have classic negative
  // prompts), so we ask for what we want rather than listing what to
  // avoid — EXCEPT for the wall directive where "no cool grey, no
  // white" adversarial language is the only way to break Flux's
  // default cool-neutral bias on bedroom interiors.
  // Lead with the palette directives when one is provided. Round 3
  // had the style.descriptor first, which for Contemporary AU
  // includes "eucalyptus green accents" — that token competed with
  // the palette's warm directive and Flux defaulted to sage-green.
  // Front-loading the palette lets it anchor before any conflicting
  // style descriptor colour words reach the sampler.
  const base: string[] = [];

  if (palette) {
    base.push(
      `COLOUR PALETTE: ${paletteName} — ${temperatureDescriptor(promptPalette)}`,
    );
    const wallLine = describeWall(promptPalette);
    if (wallLine) base.push(wallLine);
    const rolesLine = describeRoles(promptPalette);
    if (rolesLine) base.push(rolesLine);
  }

  base.push(
    // When a palette is selected, strip colour-name fragments from
    // the style descriptor — "eucalyptus green accents" would
    // contradict a "warm wheat" palette. We keep the structural and
    // material vocab (pale oak floors, lime-washed plaster) but drop
    // any "<word> accents" fragments which is where the style file
    // tends to pin specific accent colours.
    palette ? stripAccentColours(style.descriptor) : style.descriptor,
  );
  base.push(
    ...([
      facts?.room_type ? `${factsRoomType(facts.room_type)}, fully restyled` : null,
      'photorealistic interior photography',
      'natural daylight, soft shadows',
      '35mm lens, architectural digest editorial',
      'tack-sharp detail, accurate scale',
    ].filter(Boolean) as string[]),
  );

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

  // Room-bones lock. Geometry never moves.
  base.push(
    'identical room geometry to reference: same walls, same window openings, same door openings, same ceiling height, same camera angle',
  );
  // Anti-hallucination — view back to CRITICAL. Round 2 had BOTH
  // ceiling + view CRITICAL stacked → over-constrained, surface
  // transformation collapsed to 2/10. Round 3 dropped both and
  // softened the view directive → view drifted from "elevated dusk
  // suburban" to "ground-level red-roof house and lawn" in the eval
  // run. The over-constraint was the STACK of two CRITICALs, not a
  // single CRITICAL on its own. Round 4: one CRITICAL on view only.
  // Canny at 0.75 handles ceiling preservation via edges so we still
  // skip a parallel ceiling CRITICAL.
  base.push(
    'CRITICAL: exterior view through every window stays IDENTICAL to reference — same sky, weather, time of day, vegetation, buildings, horizon, elevation. Do NOT invent landscapes, lawns, fences, or outdoor scenes. Do NOT swap a dusk skyline for a daytime garden or vice-versa.',
  );

  if (mode === 'bold') {
    // Aggressive surface transformation. The wall directive itself
    // lives in the palette block above (with named colours + the
    // adversarial "no grey / no white" anti-cool language). This
    // block handles the other surfaces.
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
//
// Add the category word as a suffix if the cleaned name doesn't already
// contain it — many product names are pure brand/model strings
// ("Barakula", "Jacqueline") that mean nothing to Flux without an
// object-type anchor. With this, "Barakula" + category "Carpet" →
// "barakula carpet" so Flux paints a carpet, not a mystery noun.
function describeProduct(p: HeroProductDescriptor): string {
  const cleaned = p.name.replace(/\s*-\s*[^-]+$/g, '').toLowerCase();
  const cat = (p.category ?? '').toLowerCase().trim();
  if (!cat) return cleaned;
  const catSingular = cat.replace(/s$/, '');
  if (cleaned.includes(cat) || cleaned.includes(catSingular)) return cleaned;
  return `${cleaned} ${catSingular}`;
}

function factsRoomType(raw: string): string {
  return raw.replace(/_/g, ' ').toLowerCase();
}

// Strip "<colour-word> accents" fragments from a style descriptor when
// the user has selected a palette. The style.descriptor strings in
// STYLES are written to stand alone (Contemporary AU includes
// "eucalyptus green accents", Hamptons might include "navy and white
// accents", etc.) — but when paired with a user-selected palette,
// those baked-in colour words conflict with the palette directive and
// confuse Flux. Round 3 eval went sage-green precisely because
// "eucalyptus green accents" was in the prompt ahead of the palette
// directive. We remove only the "<word> accents" / "<word> tones"
// fragments so the structural vocab (pale oak floors, lime-washed
// plaster) survives.
function stripAccentColours(descriptor: string): string {
  return descriptor
    // "eucalyptus green accents", "navy and white accents", etc.
    .replace(/\b[\w-]+(?:\s+(?:and|&)\s+[\w-]+)?\s+(?:green|blue|red|yellow|pink|grey|gray|white|black|brown|orange|purple|teal|navy|cream|beige|sage|mint|ochre|terracotta|tan|gold|silver|copper)\s+(?:accents?|tones?)\b/gi, '')
    // any leftover "<colour> accents/tones" without a preceding adjective
    .replace(/\b(?:green|blue|red|yellow|pink|grey|gray|white|black|brown|orange|purple|teal|navy|cream|beige|sage|mint|ochre|terracotta|tan|gold|silver|copper)\s+(?:accents?|tones?)\b/gi, '')
    // double-comma / dangling comma cleanup
    .replace(/,\s*,/g, ',')
    .replace(/,\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
