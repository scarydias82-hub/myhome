// GET /api/cron/featured-products — weekly Claude-curated featured
// products selection. Invoked by Vercel cron (Sunday 16:00 UTC =
// Sunday 02:00 AEST during DST, 03:00 outside DST). See vercel.json
// for the schedule.
//
// Vercel cron requests are authenticated via a CRON_SECRET header
// (set in Vercel env). We reject anything that doesn't carry it
// — exposing this route to the public would let anyone trigger a
// $0.10 Claude call.
//
// The route returns the curation result (theme + pick count + Claude
// reasoning) so the response shows up in Vercel's cron logs for
// inspection.

import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { runFeaturedCuration } from '@/lib/featured-curation';

export const runtime = 'nodejs';
// Curation can take 30-60s under load (large prompt + Claude latency
// + retries). Leave room.
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  // Vercel attaches the CRON_SECRET as a bearer token on
  // authorization. We accept either that or an `x-cron-secret`
  // header (so the route can also be triggered manually for
  // smoke-testing).
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = request.headers.get('authorization');
  const customHeader = request.headers.get('x-cron-secret');
  const ok =
    authHeader === `Bearer ${secret}` || customHeader === secret;
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const admin = createAdminClient() as unknown as SupabaseClient;
    const result = await runFeaturedCuration(admin);
    return NextResponse.json({
      ok: true,
      ...result,
      ranAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron] featured-products failed', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
