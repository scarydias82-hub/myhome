// /vision-boards — list of the user's vision boards.
//
// Mobile-first: 1-col on mobile, 2-col md, 3-col lg+. Each board
// card is a tap target → /vision-boards/[id]. Empty state surfaces
// the value proposition + create CTA so first-time users understand
// what a vision board IS before committing to making one.

import { redirect } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Logo } from '@/components/saltbush/logo';
import { Eyebrow } from '@/components/saltbush/eyebrow';
import { DisplayHeading } from '@/components/saltbush/display-heading';
import { Button } from '@/components/ui/button';
import { isSupabaseConfigured } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface VisionBoardRow {
  id: string;
  name: string;
  cover_image_url: string | null;
  item_count: number;
  updated_at: string;
}

export default async function VisionBoardsIndexPage() {
  if (!isSupabaseConfigured) redirect('/login');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/vision-boards');

  const res = await supabase
    .from('vision_boards')
    .select('id, name, cover_image_url, item_count, updated_at')
    .order('updated_at', { ascending: false });

  const boards = (res.data as VisionBoardRow[] | null) ?? [];

  return (
    <>
      <header className="border-b border-ink/[0.06]">
        <div className="container flex items-center justify-between py-6">
          <Logo href="/dashboard" size="md" />
          <nav className="hidden gap-8 text-[14px] text-ink-soft md:flex">
            <Link href="/dashboard" className="hover:text-ink">Dashboard</Link>
            <Link href="/projects" className="hover:text-ink">Projects</Link>
            <span className="text-ink">Vision boards</span>
            <Link href="/catalogue" className="hover:text-ink">Catalogue</Link>
          </nav>
          <Link
            href="/vision-boards/new"
            className="rounded-full bg-ink px-4 py-2 font-mono text-meta uppercase tracking-eyebrow text-paper transition hover:opacity-90"
          >
            + New board
          </Link>
        </div>
      </header>

      <main className="container py-8 md:py-14">
        <div className="mb-8 max-w-2xl md:mb-10">
          <Eyebrow>Vision boards</Eyebrow>
          <DisplayHeading level={2} className="mt-3">
            Your <em>moodboards</em>.
          </DisplayHeading>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
            Save palettes, trends, and products you love into a single board. When you're ready
            to restyle a room, turn the board into a project — we'll seed the brief with
            everything you've collected.
          </p>
        </div>

        {boards.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {boards.map((b) => (
              <li key={b.id}>
                <BoardSummaryCard board={b} />
              </li>
            ))}
            <li>
              <Link
                href="/vision-boards/new"
                className="flex h-full min-h-[260px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-ink/20 p-6 text-center transition hover:border-ink/40 hover:bg-paper-warm"
              >
                <span aria-hidden className="text-clay text-[24px]">+</span>
                <p className="font-display text-h4 text-ink">New board</p>
                <p className="text-[13px] text-ink-soft">
                  Start collecting ideas for your next space.
                </p>
              </Link>
            </li>
          </ul>
        )}
      </main>
    </>
  );
}

function BoardSummaryCard({ board }: { board: VisionBoardRow }) {
  return (
    <Link
      href={`/vision-boards/${board.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-ink/[0.06] bg-cream transition hover:border-ink/20 hover:shadow-soft"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-paper-warm bg-grain">
        {board.cover_image_url ? (
          <Image
            src={board.cover_image_url}
            alt={board.name}
            fill
            sizes="(max-width: 768px) 100vw, 33vw"
            className="object-cover transition group-hover:scale-[1.02]"
            unoptimized
          />
        ) : (
          <div className="grid h-full place-items-center font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
            {board.item_count === 0 ? 'Empty board' : `${board.item_count} items`}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        <p className="font-display text-h4 leading-tight text-ink">{board.name}</p>
        <p className="font-mono text-meta uppercase tracking-eyebrow text-ink-faint">
          {board.item_count} item{board.item_count === 1 ? '' : 's'} · Updated{' '}
          {formatDate(board.updated_at)}
        </p>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-ink/15 bg-paper-warm bg-grain p-8 md:p-12">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-cream font-display text-h2 text-clay">
          ✦
        </div>
        <p className="mt-5 font-display text-h3 text-ink">No boards yet.</p>
        <p className="mt-3 text-[14px] leading-relaxed text-ink-soft md:text-[15px]">
          A vision board is a moodboard. Save a palette you love, a 2026 trend that caught your
          eye, a sofa from the catalogue, a free-text note — anything. When the board feels
          right, convert it into a project and we'll render your room around it.
        </p>
        <div className="mt-6">
          <Link href="/vision-boards/new">
            <Button variant="cta" size="lg">
              ✦ Create your first board
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
