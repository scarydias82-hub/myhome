// Skeleton for /palettes. Mirrors the page's header + eyebrow/heading
// + intro paragraph + 16-card grid so the layout doesn't jolt.

export default function PalettesLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <div className="h-7 w-32 animate-pulse rounded bg-editorial-border/50" />
          <div className="h-8 w-20 animate-pulse rounded bg-editorial-border/40" />
        </div>
      </header>
      <main className="container py-10 md:py-14">
        <div className="space-y-3">
          <div className="h-3 w-16 animate-pulse rounded bg-editorial-border/40" />
          <div className="h-10 w-72 animate-pulse rounded bg-editorial-border/40" />
          <div className="h-4 w-full max-w-3xl animate-pulse rounded bg-editorial-border/30" />
          <div className="h-4 w-2/3 max-w-2xl animate-pulse rounded bg-editorial-border/30" />
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[4/5] animate-pulse rounded-2xl bg-editorial-border/30"
            />
          ))}
        </div>
      </main>
    </div>
  );
}
