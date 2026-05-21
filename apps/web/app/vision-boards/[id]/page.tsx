// /vision-boards/[id] — detail view. Lists every item in the board
// across the four item types (palette / trend / product / note) and
// surfaces a remove control per item. Convert-to-project CTA is
// Phase 3 (#136); we render it as a teaser button for now so the
// surface anticipates the flow.

import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { isSupabaseConfigured, publicEnv } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { listPalettes, paletteSwatch } from '@/lib/palettes';
import { VisionBoardDetail } from '@/components/vision-boards/vision-board-detail';
import { VisionBoardAnalysisCard } from '@/components/vision-boards/vision-board-analysis-card';

export const dynamic = 'force-dynamic';

interface BoardRow {
  id: string;
  name: string;
  cover_image_url: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  item_type: 'palette' | 'trend' | 'product' | 'note';
  palette_id: string | null;
  trend_card_id: string | null;
  product_id: string | null;
  payload: Record<string, unknown> | null;
  position: number;
  created_at: string;
}

interface TrendRow {
  id: string;
  palette_id: string;
  palette_name: string;
  room_type: string;
  headline: string;
  image_storage_key: string;
}

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
  affiliate_url: string | null;
  category: string;
}

export default async function VisionBoardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured) redirect('/login');
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/vision-boards/${id}`);

  const [boardRes, itemsRes] = await Promise.all([
    supabase
      .from('vision_boards')
      .select('id, name, cover_image_url, item_count, created_at, updated_at')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('vision_board_items')
      .select('id, item_type, palette_id, trend_card_id, product_id, payload, position, created_at')
      .eq('board_id', id)
      .order('position', { ascending: true })
      .order('created_at', { ascending: false }),
  ]);

  const board = boardRes.data as BoardRow | null;
  if (!board) notFound();

  const items = (itemsRes.data as ItemRow[] | null) ?? [];
  const trendIds = items.filter((i) => i.trend_card_id).map((i) => i.trend_card_id as string);
  const productIds = items.filter((i) => i.product_id).map((i) => i.product_id as string);

  const [trendsRes, productsRes] = await Promise.all([
    trendIds.length > 0
      ? supabase
          .from('trend_cards')
          .select('id, palette_id, palette_name, room_type, headline, image_storage_key')
          .in('id', trendIds)
      : Promise.resolve({ data: [] as TrendRow[], error: null }),
    productIds.length > 0
      ? supabase
          .from('products')
          .select(
            'id, name, retailer, price_aud, image_url, product_url, affiliate_url, category',
          )
          .in('id', productIds)
      : Promise.resolve({ data: [] as ProductRow[], error: null }),
  ]);

  const trendCards = (trendsRes.data as TrendRow[] | null) ?? [];
  const products = (productsRes.data as ProductRow[] | null) ?? [];
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL ?? '';

  // Resolve palette swatches statically from palettes.json — no DB
  // hop needed. Indexed by palette_id slug.
  const palettesById = new Map(listPalettes().map((p) => [p.id, p]));
  const palettesData = Array.from(palettesById.values()).map((p) => ({
    id: p.id,
    name: p.name,
    vibe: p.vibe,
    swatchHexes: paletteSwatch(p),
    trendSource: p.trend_source,
  }));

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <Link
            href="/vision-boards"
            className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint hover:text-ink"
          >
            ← All boards
          </Link>
        </div>
      </header>

      <main className="container py-8 md:py-12">
        <div className="mb-6 md:mb-10">
          <Eyebrow>Vision board</Eyebrow>
          <DisplayHeading level={2} className="mt-3">
            {board.name}
          </DisplayHeading>
          <p className="mt-2 font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {board.item_count} item{board.item_count === 1 ? '' : 's'} ·{' '}
            Updated {formatDate(board.updated_at)}
          </p>
        </div>

        {/* Designer's read — Claude analysis surface. Lives above the
            item grid so users see the editorial take before they
            scroll into the components. */}
        <div className="mb-6 md:mb-8">
          <VisionBoardAnalysisCard
            boardId={board.id}
            currentItemCount={board.item_count}
          />
        </div>

        <VisionBoardDetail
          boardId={board.id}
          items={items.map((i) => ({
            id: i.id,
            itemType: i.item_type,
            paletteId: i.palette_id,
            trendCardId: i.trend_card_id,
            productId: i.product_id,
            payload: i.payload ?? {},
          }))}
          palettes={palettesData}
          trendCards={trendCards.map((t) => ({
            id: t.id,
            paletteId: t.palette_id,
            paletteName: t.palette_name,
            roomType: t.room_type,
            headline: t.headline,
            imageUrl: `${supabaseUrl}/storage/v1/object/public/trends/${t.image_storage_key}`,
          }))}
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            retailer: p.retailer,
            priceAud: p.price_aud,
            imageUrl: p.image_url,
            productUrl: p.affiliate_url ?? p.product_url,
            category: p.category,
          }))}
        />
      </main>
    </>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
