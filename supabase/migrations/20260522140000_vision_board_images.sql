-- Vision board image uploads (#139 Pass B).
--
-- Users can upload an inspiration image (Pinterest pin, IG
-- screenshot, random product photo) to their board. Claude vision
-- identifies what's in the image, we match it against our catalogue,
-- and surface the matches so the user can convert one or more into
-- product board-items.
--
-- The image itself becomes a board item with item_type='image' —
-- the storage key + matched product IDs go in payload. Users see
-- the image alongside the matched products on the board.

-- 1. Extend vision_board_items to allow item_type='image'. Both the
--    check constraint on item_type and the polymorphic ref check
--    need updating.

alter table public.vision_board_items
  drop constraint if exists vision_board_items_item_type_check;

alter table public.vision_board_items
  add constraint vision_board_items_item_type_check
  check (item_type in ('palette', 'trend', 'product', 'note', 'image'));

alter table public.vision_board_items
  drop constraint if exists vbi_polymorphic_ref;

alter table public.vision_board_items
  add constraint vbi_polymorphic_ref check (
    (item_type = 'palette' and palette_id is not null and trend_card_id is null and product_id is null)
    or (item_type = 'trend' and trend_card_id is not null and palette_id is null and product_id is null)
    or (item_type = 'product' and product_id is not null and palette_id is null and trend_card_id is null)
    or (item_type = 'note' and palette_id is null and trend_card_id is null and product_id is null)
    or (item_type = 'image' and palette_id is null and trend_card_id is null and product_id is null)
  );

-- 2. Storage bucket for uploaded inspiration images.
--    Private bucket — only the owning user can read. Filename
--    pattern: <user_id>/<uuid>.<ext> so RLS can enforce ownership
--    via path prefix.
insert into storage.buckets (id, name, public)
  values ('vision-board-uploads', 'vision-board-uploads', false)
  on conflict (id) do nothing;

-- 3. Storage object RLS policies. The convention is:
--      Object path: <user_id>/<filename>
--    Users can SELECT / INSERT / DELETE their own folder.

drop policy if exists "vision-board-uploads_owner_read" on storage.objects;
create policy "vision-board-uploads_owner_read" on storage.objects
  for select to authenticated using (
    bucket_id = 'vision-board-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vision-board-uploads_owner_insert" on storage.objects;
create policy "vision-board-uploads_owner_insert" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'vision-board-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vision-board-uploads_owner_delete" on storage.objects;
create policy "vision-board-uploads_owner_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'vision-board-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
