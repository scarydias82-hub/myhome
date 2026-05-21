// Vision board Claude analysis (#139).
//
// Runs one Claude Sonnet call per analysis with structured JSON output
// covering four capabilities the user requested:
//
//   1. Coherence read       — through-line + tensions + strength
//   2. Room styles          — which room styles this board applies to
//   3. Cross-app popularity — how this board compares to all other
//                             users' boards (palette + style frequency)
//   4. Retailer suggestions — AU retailers to explore for items
//                             beyond our catalogue
//
// We feed Claude the board's contents PLUS pre-computed popularity
// stats (computed by SQL aggregation across all boards via the admin
// client). Claude doesn't do math; we hand it numbers and ask it to
// write the editorial copy.

import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { withAnthropicRetry } from '@/lib/anthropic-retry';
import { listPalettes } from '@/lib/palettes';

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY missing');
  _anthropic = new Anthropic({ apiKey: key });
  return _anthropic;
}

interface BoardItemRow {
  id: string;
  item_type: 'palette' | 'trend' | 'product' | 'note' | 'image';
  palette_id: string | null;
  trend_card_id: string | null;
  product_id: string | null;
  payload: Record<string, unknown> | null;
}

export interface VisionBoardAnalysisResponse {
  coherence: {
    through_line: string;
    tensions: string[];
    strength: 'high' | 'medium' | 'low';
    summary_for_user: string;
  };
  room_styles: string[];
  popularity: {
    comparable_boards: number;
    headline: string;
    differentiator: string;
  };
  retailer_recommendations: Array<{
    retailer: string;
    reason: string;
    categories: string[];
  }>;
}

export interface AnalysisSnapshot {
  item_count: number;
  by_type: Record<string, number>;
}

// AU retailers we know about — pulled from the scraper config. Claude
// can suggest from this set so its recommendations stay grounded in
// real, scrapable retailers (vs hallucinating obscure shops).
const KNOWN_RETAILERS = [
  { name: 'Coco Republic', strengths: ['sofas', 'dining', 'lighting', 'luxe'] },
  { name: 'GlobeWest', strengths: ['contemporary', 'sofas', 'chairs', 'ottomans'] },
  { name: 'Poliform', strengths: ['premium', 'sofas', 'dining', 'storage'] },
  { name: 'Freedom Furniture', strengths: ['accessible', 'sofas', 'dining', 'storage'] },
  { name: 'Adairs', strengths: ['linen', 'quilts', 'cushions', 'window'] },
  { name: 'ABI Interiors', strengths: ['tapware', 'shower', 'bathroom accessories'] },
  { name: 'Tile Cloud', strengths: ['bathroom tiles', 'splashbacks', 'mosaic'] },
  { name: 'Beacon Lighting', strengths: ['lighting', 'pendants', 'lamps'] },
  { name: 'Carpet Court', strengths: ['carpets', 'curtains', 'sheers'] },
  { name: 'Choices Flooring', strengths: ['hardwood', 'engineered', 'flooring'] },
  { name: 'The Rug Establishment', strengths: ['rugs', 'runners'] },
  { name: 'Bed Threads', strengths: ['linen', 'bedding', 'quilts'] },
];

const ANALYSIS_SYSTEM = `
You are myMaison's principal designer reviewing a user's vision board.

Your job is to deliver four things in a single JSON response:

1. COHERENCE READ — what's the through-line of this board? What
   tensions exist between items that pull in different directions?
   How strong is the editorial story (high/medium/low)?

2. ROOM STYLES — which room styles does this board apply to? Pick
   from: scandi, japandi, hamptons, coastal, heritage, federation,
   mid_century_walnut, modernist_restraint, english_country,
   warm_minimalist, contemporary_au, industrial, biophilic,
   modern_organic. Pick 1–3, ranked by fit.

3. POPULARITY — interpret the numeric popularity stats we hand you.
   Write a "headline" (1 sentence) and a "differentiator" (1
   sentence) so the user understands how their board compares to
   everyone else's. If the user is in the mainstream, say so
   confidently. If they're unusual, name the move that makes them so.

4. RETAILER RECOMMENDATIONS — based on the board's content and
   gaps, suggest 2–3 AU retailers the user should explore. Pick
   from the known retailers list we hand you. Be specific about
   WHY (which categories, which style match). Don't pick retailers
   we already have products from heavily — pick ones that fill
   gaps or strengthen the through-line.

Tone:
- Designer voice — confident, opinionated, warm. Not corporate.
- Use Australian editorial register: "this leans heritage",
  "you've got a strong move with the brass lamp", "the navy is
  a confident departure".
- Address the user directly: "Your board…", "You've picked…",
  "Try…".

Output ONLY this JSON shape inside a fenced block:

\`\`\`json
{
  "coherence": {
    "through_line": "<1 sentence — what unifies this board>",
    "tensions": ["<each tension as a single short sentence>"],
    "strength": "high" | "medium" | "low",
    "summary_for_user": "<2-3 sentences in designer voice — what's working, what to consider>"
  },
  "room_styles": ["<style_slug>", ...],
  "popularity": {
    "comparable_boards": <integer from the popularity stats we gave you>,
    "headline": "<1 sentence>",
    "differentiator": "<1 sentence>"
  },
  "retailer_recommendations": [
    {
      "retailer": "<from known list>",
      "reason": "<1 sentence — why this retailer for this board>",
      "categories": ["<category strings>"]
    }
  ]
}
\`\`\`

Hard rules:
- 2–3 retailer recommendations, never more.
- If the board has < 3 items, set strength to "low" and the
  through_line to "Too early — keep adding items." Skip
  retailer_recommendations (empty array).
- If popularity stats show < 10 total boards, set differentiator
  to "Too early to tell — myMaison is still building the
  baseline."
`.trim();

interface BoardContext {
  boardName: string;
  itemCount: number;
  palettes: Array<{ id: string; name: string; vibe: string; trend_source: string }>;
  trends: Array<{ palette_name: string; room_type: string; headline: string }>;
  products: Array<{
    name: string;
    retailer: string;
    category: string;
    style_tags: string[];
    palette_tags: string[];
  }>;
  notes: string[];
  imageCount: number;
}

interface PopularityStats {
  totalBoards: number;
  // For each palette_id in the user's board, how many OTHER boards have it
  paletteOverlap: Array<{ palette_id: string; palette_name: string; otherBoardsWithThis: number }>;
  // Most popular palette globally (for context)
  topPaletteGlobal: { palette_id: string; palette_name: string; boardCount: number } | null;
  // Total products saved across all boards (a sanity-check number)
  totalProductsSaved: number;
}

/**
 * Run the analysis. Loads the board, computes popularity, calls
 * Claude, persists the result. Returns the parsed response.
 */
export async function runBoardAnalysis(
  admin: SupabaseClient,
  boardId: string,
): Promise<{ response: VisionBoardAnalysisResponse; snapshot: AnalysisSnapshot }> {
  // 1. Pull the board + items via admin (we may need cross-board
  //    data for popularity which RLS-scoped queries can't see).
  const boardRes = await admin
    .from('vision_boards')
    .select('id, name, item_count, user_id')
    .eq('id', boardId)
    .maybeSingle();
  const board = boardRes.data as
    | { id: string; name: string; item_count: number; user_id: string }
    | null;
  if (!board) throw new Error(`Board ${boardId} not found`);

  const itemsRes = await admin
    .from('vision_board_items')
    .select('id, item_type, palette_id, trend_card_id, product_id, payload')
    .eq('board_id', boardId);
  const items = (itemsRes.data as BoardItemRow[] | null) ?? [];

  // 2. Hydrate references for the prompt context.
  const palettesById = new Map(listPalettes().map((p) => [p.id, p]));
  const trendIds = items.filter((i) => i.trend_card_id).map((i) => i.trend_card_id as string);
  const productIds = items.filter((i) => i.product_id).map((i) => i.product_id as string);

  const [trendsRes, productsRes] = await Promise.all([
    trendIds.length > 0
      ? admin
          .from('trend_cards')
          .select('id, palette_id, palette_name, room_type, headline')
          .in('id', trendIds)
      : Promise.resolve({ data: [] }),
    productIds.length > 0
      ? admin
          .from('products')
          .select('id, name, retailer, category, style_tags, palette_tags')
          .in('id', productIds)
      : Promise.resolve({ data: [] }),
  ]);

  const trends = (trendsRes.data as Array<{
    palette_name: string;
    room_type: string;
    headline: string;
  }> | null) ?? [];
  const products = (productsRes.data as Array<{
    name: string;
    retailer: string;
    category: string;
    style_tags: string[] | null;
    palette_tags: string[] | null;
  }> | null) ?? [];

  const ctx: BoardContext = {
    boardName: board.name,
    itemCount: board.item_count,
    palettes: items
      .filter((i) => i.item_type === 'palette' && i.palette_id)
      .map((i) => {
        const p = palettesById.get(i.palette_id as string);
        return p
          ? { id: p.id, name: p.name, vibe: p.vibe, trend_source: p.trend_source }
          : { id: i.palette_id as string, name: 'Unknown', vibe: '', trend_source: '' };
      }),
    trends: trends.map((t) => ({
      palette_name: t.palette_name,
      room_type: t.room_type,
      headline: t.headline,
    })),
    products: products.map((p) => ({
      name: p.name,
      retailer: p.retailer,
      category: p.category,
      style_tags: p.style_tags ?? [],
      palette_tags: p.palette_tags ?? [],
    })),
    notes: items
      .filter((i) => i.item_type === 'note')
      .map((i) => (i.payload?.body as string | undefined) ?? '')
      .filter((s) => s.length > 0),
    imageCount: items.filter((i) => i.item_type === 'image').length,
  };

  // 3. Compute popularity. We use the admin client so we can read
  //    across all users' boards — RLS would scope us to just this
  //    user's boards otherwise.
  const popularity = await computePopularity(admin, board.user_id, ctx.palettes.map((p) => p.id));

  // 4. Build the prompt.
  const userMessage = [
    `Analyse this vision board.`,
    '',
    `## BOARD: "${ctx.boardName}"`,
    `Items: ${ctx.itemCount} total`,
    `  • palettes: ${ctx.palettes.length}`,
    `  • trend cards: ${ctx.trends.length}`,
    `  • products: ${ctx.products.length}`,
    `  • notes: ${ctx.notes.length}`,
    `  • uploaded images: ${ctx.imageCount}`,
    '',
    '## PALETTES SAVED',
    ctx.palettes.length > 0
      ? ctx.palettes
          .map((p) => `- ${p.name} — ${p.vibe} (source: ${p.trend_source})`)
          .join('\n')
      : '(none)',
    '',
    '## TRENDS SAVED',
    ctx.trends.length > 0
      ? ctx.trends
          .map(
            (t) =>
              `- "${t.headline}" — ${t.palette_name} in a ${t.room_type.replace(/_/g, ' ')}`,
          )
          .join('\n')
      : '(none)',
    '',
    '## PRODUCTS SAVED',
    ctx.products.length > 0
      ? ctx.products
          .map(
            (p) =>
              `- ${p.name} (${p.retailer}, ${p.category}) — style: ${p.style_tags.slice(0, 3).join(', ') || '—'}`,
          )
          .join('\n')
      : '(none)',
    '',
    '## NOTES',
    ctx.notes.length > 0 ? ctx.notes.map((n) => `> ${n}`).join('\n') : '(none)',
    '',
    '## POPULARITY STATS (cross-app, computed)',
    `Total boards on myMaison: ${popularity.totalBoards}`,
    `Total products saved across all boards: ${popularity.totalProductsSaved}`,
    popularity.topPaletteGlobal
      ? `Most-saved palette globally: ${popularity.topPaletteGlobal.palette_name} (in ${popularity.topPaletteGlobal.boardCount} boards)`
      : 'No global palette ranking yet.',
    '',
    popularity.paletteOverlap.length > 0
      ? [
          'How this user\'s palettes compare:',
          ...popularity.paletteOverlap.map(
            (o) =>
              `  • ${o.palette_name}: shared with ${o.otherBoardsWithThis} other boards`,
          ),
        ].join('\n')
      : 'No palette saves to compare against yet.',
    '',
    '## KNOWN AU RETAILERS (pick from this set for recommendations)',
    KNOWN_RETAILERS.map((r) => `- ${r.name}: ${r.strengths.join(', ')}`).join('\n'),
    '',
    'Return ONLY the JSON, no preamble.',
  ].join('\n');

  // 5. Call Claude.
  let message: Anthropic.Message;
  try {
    message = await withAnthropicRetry(
      () =>
        getAnthropic().messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1500,
          temperature: 0.4,
          system: ANALYSIS_SYSTEM,
          messages: [{ role: 'user', content: userMessage }],
        }),
      { label: 'vision-board-analysis' },
    );
  } catch (err) {
    throw new Error(
      `Claude analysis failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
    .trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  let parsed: VisionBoardAnalysisResponse;
  try {
    parsed = JSON.parse(cleaned) as VisionBoardAnalysisResponse;
  } catch (err) {
    throw new Error(
      `Claude returned unparseable JSON: ${err instanceof Error ? err.message : String(err)}\nRaw: ${raw.slice(0, 500)}`,
    );
  }

  // 6. Persist + return.
  const snapshot: AnalysisSnapshot = {
    item_count: ctx.itemCount,
    by_type: {
      palette: ctx.palettes.length,
      trend: ctx.trends.length,
      product: ctx.products.length,
      note: ctx.notes.length,
      image: ctx.imageCount,
    },
  };

  await admin.from('vision_board_analyses').insert({
    board_id: boardId,
    response: parsed,
    snapshot,
  });

  return { response: parsed, snapshot };
}

// Popularity computation. We use the admin client because cross-user
// counts need to bypass RLS.
async function computePopularity(
  admin: SupabaseClient,
  excludeUserId: string,
  userPaletteIds: string[],
): Promise<PopularityStats> {
  // Total boards (excluding the requesting user's own boards — we
  // want to know how this user compares to everyone ELSE).
  const totalRes = await admin
    .from('vision_boards')
    .select('id', { count: 'exact', head: true })
    .neq('user_id', excludeUserId);
  const totalBoards = totalRes.count ?? 0;

  // Total products saved across all boards.
  const totalProductsRes = await admin
    .from('vision_board_items')
    .select('id', { count: 'exact', head: true })
    .eq('item_type', 'product');
  const totalProductsSaved = totalProductsRes.count ?? 0;

  // Palette popularity globally (top palette). Fetch all palette
  // items, aggregate in memory — board volume is low so in-memory
  // counting is fine for now. Switch to a SQL view when boards > 10k.
  const paletteItemsRes = await admin
    .from('vision_board_items')
    .select('palette_id, board_id')
    .eq('item_type', 'palette');
  const paletteRows =
    (paletteItemsRes.data as { palette_id: string; board_id: string }[] | null) ?? [];

  // Count distinct boards per palette globally (top palette).
  const paletteToBoards = new Map<string, Set<string>>();
  for (const r of paletteRows) {
    if (!paletteToBoards.has(r.palette_id)) paletteToBoards.set(r.palette_id, new Set());
    paletteToBoards.get(r.palette_id)!.add(r.board_id);
  }

  const palettesById = new Map(listPalettes().map((p) => [p.id, p]));

  let topPaletteGlobal: PopularityStats['topPaletteGlobal'] = null;
  let topCount = 0;
  for (const [palette_id, boardSet] of paletteToBoards) {
    if (boardSet.size > topCount) {
      topCount = boardSet.size;
      topPaletteGlobal = {
        palette_id,
        palette_name: palettesById.get(palette_id)?.name ?? palette_id,
        boardCount: boardSet.size,
      };
    }
  }

  // For each of the user's palette picks, count how many OTHER
  // boards share it (i.e., boards owned by users other than this
  // one). We need a join — but the data we already have is enough:
  // for each user_palette_id, sum the count of boards in
  // paletteToBoards minus 1 if the user themselves was in that set.
  // For correctness we need to know which boards belong to which
  // user, so fetch a board→user map for any palette of interest.
  const paletteOverlap: PopularityStats['paletteOverlap'] = [];
  if (userPaletteIds.length > 0) {
    // Get board owners for boards that contain any of these palettes.
    const relevantBoardIds = new Set<string>();
    for (const pid of userPaletteIds) {
      const boards = paletteToBoards.get(pid);
      if (boards) for (const b of boards) relevantBoardIds.add(b);
    }
    let boardOwners = new Map<string, string>();
    if (relevantBoardIds.size > 0) {
      const ownersRes = await admin
        .from('vision_boards')
        .select('id, user_id')
        .in('id', Array.from(relevantBoardIds));
      const ownerRows = (ownersRes.data as { id: string; user_id: string }[] | null) ?? [];
      boardOwners = new Map(ownerRows.map((r) => [r.id, r.user_id]));
    }

    for (const pid of userPaletteIds) {
      const boards = paletteToBoards.get(pid) ?? new Set();
      let otherCount = 0;
      for (const b of boards) {
        if (boardOwners.get(b) !== excludeUserId) otherCount += 1;
      }
      paletteOverlap.push({
        palette_id: pid,
        palette_name: palettesById.get(pid)?.name ?? pid,
        otherBoardsWithThis: otherCount,
      });
    }
  }

  return {
    totalBoards,
    paletteOverlap,
    topPaletteGlobal,
    totalProductsSaved,
  };
}

/**
 * Returns the latest cached analysis for a board, or null if none
 * exists yet. Used by the dashboard / detail page on first load
 * (we don't auto-run — the user clicks "Get designer's read").
 */
export async function getLatestAnalysis(
  admin: SupabaseClient,
  boardId: string,
): Promise<
  | {
      response: VisionBoardAnalysisResponse;
      snapshot: AnalysisSnapshot;
      createdAt: string;
    }
  | null
> {
  const res = await admin
    .from('vision_board_analyses')
    .select('response, snapshot, created_at')
    .eq('board_id', boardId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!res.data) return null;
  const row = res.data as {
    response: VisionBoardAnalysisResponse;
    snapshot: AnalysisSnapshot;
    created_at: string;
  };
  return {
    response: row.response,
    snapshot: row.snapshot,
    createdAt: row.created_at,
  };
}
