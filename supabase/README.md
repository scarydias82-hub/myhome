# Supabase

Schema and local config for myHome's Postgres + Auth + Storage.

## Apply migrations to your project

```bash
# One-time: install CLI
brew install supabase/tap/supabase       # macOS
# scoop install supabase                 # Windows (or use the standalone download)

# Link this repo to your Supabase project
supabase login
supabase link --project-ref <your-project-ref>

# Push schema
supabase db push
```

Or paste the contents of `migrations/20260518000000_init_schema.sql` into the SQL editor in the Supabase dashboard.

## Auth providers

Enable Google in the dashboard: Authentication → Providers → Google. Use the OAuth client created in Google Cloud Console; set the redirect URL to:

```
https://<your-project-ref>.supabase.co/auth/v1/callback
```

Add your production site URL under Authentication → URL Configuration → Site URL + Additional Redirect URLs.

## Convention

- File names: `YYYYMMDDHHMMSS_short_slug.sql` (Supabase CLI compatible).
- Every user-owned table has RLS **on** and an `owner_all` policy keyed on `auth.uid() = user_id`.
- `products` is a shared catalog; read open to authenticated users, writes via service role only.
