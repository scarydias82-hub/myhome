// Skeleton shown while the server renders /vision-boards. Matches
// the page's header band + heading + boards grid so layout doesn't
// jolt when real content streams in.

export default function VisionBoardsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <div className="h-7 w-32 animate-pulse rounded bg-editorial-border/50" />
          <div className="h-8 w-24 animate-pulse rounded bg-editorial-border/40" />
        </div>
      </header>
      <main className="container py-8 md:py-14">
        <div className="space-y-3">
          <div className="h-3 w-20 animate-pulse rounded bg-editorial-border/40" />
          <div className="h-10 w-64 animate-pulse rounded bg-editorial-border/40" />
        </div>
        <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse rounded bg-editorial-border/30"
            />
          ))}
        </div>
      </main>
    </div>
  );
}
