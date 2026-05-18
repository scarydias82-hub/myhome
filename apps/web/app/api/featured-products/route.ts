// GET /api/featured-products?style=japandi&paletteId=warm-grounded-earth
//
// Returns 8-12 hero products spread across furniture categories. Used by the
// "Feature hero products" step on /rooms/new — the user picks 1-3 to bias the
// Flux prompt toward those specific items.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getStyle } from '@/lib/styles';
import { getPalette } from '@/lib/palettes';

export const runtime = 'nodejs';

const HERO_CATEGORIES = [
  'Sofas',
  'Chairs',
  'Coffee Tables',
  'Side Tables',
  'Dining',
  'Lighting',
  'Beds',
  'Rugs',
];

interface ProductRow {
  id: string;
  name: string;
  retailer: string;
  category: string;
  price_aud: number | null;
  image_url: string;
  product_url: string;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const styleSlug = request.nextUrl.searchParams.get('style');
  const paletteId = request.nextUrl.searchParams.get('paletteId');
  const style = styleSlug ? getStyle(styleSlug) : null;
  const palette = paletteId ? getPalette(paletteId) : null;

  const admin = createAdminClient() as unknown as SupabaseClient;
  // Two items per hero category — gives the user variety without overwhelming.
  const perCategory = 2;
  const collected: ProductRow[] = [];
  for (const category of HERO_CATEGORIES) {
    const { data, error } = await admin
      .from('products')
      .select('id, name, retailer, category, price_aud, image_url, product_url')
      .eq('category', category)
      .not('image_url', 'is', null)
      .order('price_aud', { ascending: false, nullsFirst: false })
      .limit(perCategory);
    if (!error && data) collected.push(...(data as ProductRow[]));
  }

  return NextResponse.json({
    products: collected,
    style: style ? { slug: style.slug, name: style.name } : null,
    palette: palette ? { id: palette.id, name: palette.name } : null,
  });
}
