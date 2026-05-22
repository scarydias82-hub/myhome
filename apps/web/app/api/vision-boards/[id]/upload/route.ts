// POST /api/vision-boards/[id]/upload — accept an inspiration
// image, store it in the vision-board-uploads bucket, run Claude
// vision identification + catalogue match, and (optionally) attach
// it as an 'image' board item with the matched products in payload.
//
// Multipart body:
//   • photo: File (jpeg | png | webp, ≤ 4 MB after resize)
//
// Response:
//   {
//     itemId: string,         // the newly-inserted vision_board_items.id
//     storageKey: string,     // bucket-relative path
//     identification: ClaudeImageIdentification,
//     matches: MatchedProduct[]
//   }

import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { identifyImage, matchCatalogue } from '@/lib/vision-board-image-match';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — Vercel multipart cap is 4.5
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(request: NextRequest, ctx: RouteCtx) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const { id: boardId } = await ctx.params;

  // Ownership check
  const ownershipRes = await supabase
    .from('vision_boards')
    .select('id')
    .eq('id', boardId)
    .maybeSingle();
  if (!ownershipRes.data) {
    return NextResponse.json({ error: 'Board not found.' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data.' }, { status: 400 });
  }

  const file = formData.get('photo') as File | null;
  if (!file) return NextResponse.json({ error: 'Missing photo.' }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Use a JPG, PNG or WebP image.' },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'Image too large. Keep it under 4 MB.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // Wall-clock instrumentation. The route has a 60s Vercel budget;
  // when it times out we want the logs to tell us which stage ate
  // the budget (storage upload / Claude identify / catalogue match /
  // DB insert).
  const t0 = Date.now();
  console.log(
    `[vision-board-upload] start boardId=${boardId} sizeBytes=${file.size} type=${file.type}`,
  );

  // 1. Upload to Storage. Path: <user_id>/<uuid>.<ext> — the RLS
  //    policy on storage.objects checks the user_id prefix.
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const objectKey = `${user.id}/${randomUUID()}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const uploadRes = await admin.storage
    .from('vision-board-uploads')
    .upload(objectKey, buffer, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadRes.error) {
    console.error('[vision-board-upload] storage failed', uploadRes.error);
    return NextResponse.json({ error: 'Could not store the image.' }, { status: 500 });
  }
  const tStorage = Date.now();
  console.log(`[vision-board-upload] storage done in ${tStorage - t0}ms`);

  // 2. Identify the product with Claude vision.
  const base64 = buffer.toString('base64');
  let identification;
  try {
    identification = await identifyImage(
      base64,
      file.type as 'image/jpeg' | 'image/png' | 'image/webp',
    );
  } catch (err) {
    const elapsed = Date.now() - tStorage;
    // Clean up the upload — leaving orphan blobs costs storage.
    await admin.storage.from('vision-board-uploads').remove([objectKey]);
    console.error(`[vision-board-upload] identify failed after ${elapsed}ms`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Identification failed.' },
      { status: 500 },
    );
  }
  const tIdentify = Date.now();
  console.log(`[vision-board-upload] identify done in ${tIdentify - tStorage}ms`);

  // 3. Match against the catalogue.
  const matches = await matchCatalogue(admin, identification);
  const tMatch = Date.now();
  console.log(
    `[vision-board-upload] match done in ${tMatch - tIdentify}ms (${matches.length} matches)`,
  );

  // 4. Persist as an 'image' board item with the storage key +
  //    matched product IDs in payload. The detail page renders this
  //    as an image card with a "matched products" strip below it.
  const insertRes = await admin
    .from('vision_board_items')
    .insert({
      board_id: boardId,
      item_type: 'image',
      payload: {
        storage_key: objectKey,
        identification,
        matched_product_ids: matches.map((m) => m.id),
      },
    })
    .select('id')
    .maybeSingle();
  const row = insertRes.data as { id: string } | null;
  if (insertRes.error || !row) {
    // Roll back the storage upload.
    await admin.storage.from('vision-board-uploads').remove([objectKey]);
    console.error('[vision-board-upload] db insert failed', insertRes.error);
    return NextResponse.json({ error: 'Could not save the image.' }, { status: 500 });
  }
  console.log(`[vision-board-upload] complete in ${Date.now() - t0}ms total`);

  return NextResponse.json({
    itemId: row.id,
    storageKey: objectKey,
    identification,
    matches,
  });
}
