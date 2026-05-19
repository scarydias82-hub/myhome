'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

type Mode = 'signin' | 'signup';

// Editorial-brand email form. Renders the same Supabase auth flow as the
// Saltbush version, restyled with the myMaison editorial tokens (cream,
// espresso ink, cognac, taupe; Playfair / DM Sans / DM Mono).
export function EmailAuthFormEditorial({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);

    const supabase = createClient();
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) {
          setError(err.message);
          return;
        }
        startTransition(() => router.replace(next ?? '/dashboard'));
      } else {
        const { error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
              next ?? '/dashboard',
            )}`,
          },
        });
        if (err) {
          setError(err.message);
          return;
        }
        setInfo('Check your email to confirm your account, then sign in.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const busy = isPending || submitting;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="email"
          className="block font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-editorial-border bg-editorial-cream px-4 py-2.5 font-dmsans text-[14px] text-editorial-ink placeholder:text-editorial-taupe/60 focus:border-editorial-cognac focus:outline-none focus:ring-2 focus:ring-editorial-cognac/30"
        />
      </div>
      <div className="space-y-1.5">
        <label
          htmlFor="password"
          className="block font-dmmono text-[10px] uppercase tracking-[0.14em] text-editorial-taupe"
        >
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-editorial-border bg-editorial-cream px-4 py-2.5 font-dmsans text-[14px] text-editorial-ink placeholder:text-editorial-taupe/60 focus:border-editorial-cognac focus:outline-none focus:ring-2 focus:ring-editorial-cognac/30"
        />
        {mode === 'signup' ? (
          <p className="font-dmsans text-[12px] text-editorial-taupe">
            At least eight characters.
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-md border border-editorial-cognac/40 bg-editorial-cognac/10 px-3 py-2 font-dmsans text-[13px] text-editorial-ink">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="rounded-md border border-editorial-border bg-editorial-surface px-3 py-2 font-dmsans text-[13px] text-editorial-taupe">
          {info}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-editorial-ink px-5 py-3 font-dmsans text-[14px] font-medium text-editorial-cream transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy
          ? mode === 'signin'
            ? 'Signing in…'
            : 'Creating account…'
          : mode === 'signin'
            ? 'Sign in'
            : 'Create account'}
      </button>
    </form>
  );
}
