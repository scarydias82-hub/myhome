// Skeleton shown while the server renders /projects. Matches the
// page's header band + heading + project card grid so layout
// doesn't jolt when real content streams in.

export default function ProjectsLoading() {
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
          <div className="h-10 w-64 animate-pulse rounded bg-editorial-border/40" />
        </div>
        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-video animate-pulse rounded bg-editorial-border/30" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-editorial-border/40" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-editorial-border/30" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
