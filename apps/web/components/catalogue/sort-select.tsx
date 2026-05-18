'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const params = useSearchParams();

  function onChange(next: string) {
    const sp = new URLSearchParams(params.toString());
    sp.set('sort', next);
    router.push(`/catalogue?${sp.toString()}`);
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-pill border border-ink/15 bg-cream px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-ink"
    >
      <option value="price_desc">Sort · Price ↓</option>
      <option value="price_asc">Sort · Price ↑</option>
      <option value="name">Sort · Name</option>
    </select>
  );
}
