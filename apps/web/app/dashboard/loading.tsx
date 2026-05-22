// Skeleton shown while the server renders /dashboard. Mirrors the
// sticky TopNav band + hero greeting + 4-tile quick-action grid +
// one carousel band so the layout doesn't jolt when real content
// streams in.

export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="sticky top-0 z-40 h-[52px] border-b border-editorial-border bg-editorial-cream/85 backdrop-blur" />
      <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-6 md:py-8">
        <div className="space-y-3">
          <div className="h-3 w-24 animate-pulse rounded bg-editorial-border/40" />
          <div className="h-10 w-2/3 max-w-md animate-pulse rounded bg-editorial-border/40" />
          <div className="h-4 w-1/2 max-w-sm animate-pulse rounded bg-editorial-border/30" />
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[4/3] animate-pulse rounded-lg bg-editorial-border/30"
            />
          ))}
        </div>
        <div className="mt-10 space-y-4">
          <div className="h-6 w-40 animate-pulse rounded bg-editorial-border/40" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-40 w-32 flex-shrink-0 animate-pulse rounded bg-editorial-border/30"
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
