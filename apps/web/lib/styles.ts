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

export function buildPrompt(
  style: HardcodedStyle,
  facts?: RoomFacts | null,
  heroProducts?: HeroProductDescriptor[] | null,
): string {
  // The architecture-preservation tokens at the end matter as much as the
  // style descriptor. Flux respects positive-language directives much better
  // than negative ones (it doesn't have classic negative prompts), so we ask
  // for what we want rather than listing what to avoid.
  const base = [
    style.descriptor,
    facts?.room_type ? `${factsRoomType(facts.room_type)}, restyled` : null,
    'photorealistic interior photography',
    'natural daylight, soft shadows',
    '35mm lens, architectural digest editorial',
    'tack-sharp detail, accurate scale',
  ].filter(Boolean) as string[];

  if (facts) {
    // Architecture-preserving directives derived from the verified analysis.
    const preserve: string[] = [];
    if (facts.architectural_features && facts.architectural_features.length > 0) {
      preserve.push(`keep existing ${facts.architectural_features.slice(0, 4).join(', ')}`);
    }
    if (facts.flooring) {
      preserve.push(`retain ${facts.flooring} flooring exactly`);
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

  base.push('preserve existing walls, windows, doors, ceiling layout exactly');
  base.push('same camera angle and room proportions as reference photo');
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
