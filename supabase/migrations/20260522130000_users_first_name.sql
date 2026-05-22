-- Add first_name to public.users so the dashboard can greet users by
-- their real first name instead of guessing from the email prefix.
-- Also wires raw_user_meta_data.first_name into the auth → public.users
-- trigger so a future signup form can supply it without another
-- migration. Backfill of existing accounts is intentionally not in
-- this migration — it's run separately via Supabase Studio so the
-- list of beta-tester emails doesn't get committed to source control.

alter table public.users
  add column if not exists first_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, first_name)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data->>'first_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
