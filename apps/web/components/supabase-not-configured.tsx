export function SupabaseNotConfigured() {
  return (
    <div className="rounded-md border-l-2 border-clay bg-paper-warm p-5 text-[13px] leading-relaxed text-ink-soft">
      <p className="font-medium text-ink">Supabase isn't configured yet.</p>
      <p className="mt-1">
        Add <code className="rounded bg-paper px-1 py-0.5 font-mono text-[11px]">
          NEXT_PUBLIC_SUPABASE_URL
        </code>{' '}
        and{' '}
        <code className="rounded bg-paper px-1 py-0.5 font-mono text-[11px]">
          NEXT_PUBLIC_SUPABASE_ANON_KEY
        </code>{' '}
        to <code className="rounded bg-paper px-1 py-0.5 font-mono text-[11px]">apps/web/.env.local</code>{' '}
        to enable sign-in. See <code className="font-mono text-[11px]">docs/SETUP.md</code>.
      </p>
    </div>
  );
}
