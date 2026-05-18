export function SupabaseNotConfigured() {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm">
      <p className="font-medium">Supabase isn't configured yet.</p>
      <p className="mt-1 text-muted-foreground">
        Add <code className="rounded bg-background px-1 py-0.5 text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{' '}
        and{' '}
        <code className="rounded bg-background px-1 py-0.5 text-xs">
          NEXT_PUBLIC_SUPABASE_ANON_KEY
        </code>{' '}
        to <code className="rounded bg-background px-1 py-0.5 text-xs">apps/web/.env.local</code> to
        enable sign-in. See <code>docs/SETUP.md</code>.
      </p>
    </div>
  );
}
