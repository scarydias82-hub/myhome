# Claude Code — working instructions for myMaison

Read this every session. It encodes the conventions the human owner relies on.

## The living-doc protocol

`docs/OVERVIEW.md` is the **single source of truth** for the business, the
system, the product today, and the runbook. Keep it honest by updating it as
you ship, not after.

**Rules of thumb — when to touch which OVERVIEW section:**

| If the commit changes…                          | Update OVERVIEW…                          |
|--------------------------------------------------|-------------------------------------------|
| A user-facing flow                               | §5 (How the application currently works)  |
| An API route or pipeline stage                   | §5.2 (Pipeline, file by file)             |
| A new migration / table                          | §4.3 (Key tables)                         |
| A new vendor / model / service swap              | §4.2 (Each component) and §4.5 (Why these choices) |
| A pricing or revenue decision                    | §2 (Business model)                       |
| Anything about strategy, marketing, GTM, retailers| §3 (Business strategy)                   |
| A new feature lands                              | Move it from §6 (Roadmap) to §6.7 (Recently shipped) |
| Closed-beta lock state changes                   | §2.5 and §7.3                              |
| **Always**                                       | The `Last verified` line at the top + a one-line entry in the Changelog block |

If unsure whether OVERVIEW needs touching, ask the owner. Better to
over-document than let it drift.

## Commit conventions

- Conventional Commits with scope: `feat(web): ...`, `fix(web): ...`,
  `chore(web): ...`, `docs: ...`, `feat(scraper): ...`.
- Subject line under 70 chars. Use the body for the *why*.
- Co-author tag every commit:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- Pass commit messages via HEREDOC so formatting survives.
- Don't amend — prefer new commits unless the owner asks.
- Run typecheck before committing anything substantial:
  ```
  pnpm --filter web tsc --noEmit
  ```
  Don't ship red.

## Where things live (quick reference)

| Path                                | What                                          |
|-------------------------------------|-----------------------------------------------|
| `apps/web/`                         | Next.js 16 app, deployed to Vercel (syd1)     |
| `apps/web/app/api/**`               | Server routes (render, stage, projects, …)    |
| `apps/web/lib/`                     | Server helpers (fal, vision, designer, matching, staging) |
| `apps/web/components/`              | UI — `dashboard/`, `renders/`, `projects/`, `saltbush/` (legacy), `ui/` (shadcn) |
| `apps/scraper/`                     | Standalone pnpm app for catalogue + trends    |
| `supabase/migrations/`              | Timestamped SQL migrations                    |
| `docs/OVERVIEW.md`                  | Front-door doc — read this before any major change |
| `docs/DESIGN-BRIEF.md`              | Editorial brand spec (still current)          |
| `BRIEF.md`                          | Original product brief (M0–M2, historical)    |

The legacy `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `docs/DEPLOY.md` are
historical (M0 FastAPI/Fly era). Don't follow them — read OVERVIEW.md.

## Brand non-negotiables

- **Sentence case copy.** Never Title Case anywhere in the product UI.
- **Wordmark**: `my` italic taupe + `Maison` roman espresso, paired with a
  small Beta chip until we exit beta.
- **Type:** Playfair Display (display), DM Sans (body), DM Mono (metadata + caps).
- **Palette tokens:** `editorial-cream`, `editorial-surface`, `editorial-ink`,
  `editorial-taupe`, `editorial-cognac`, `editorial-border`,
  `editorial-borderStrong`. Defined in `apps/web/tailwind.config.ts`.
- **Public surfaces** (`/`, `/login`, `/signup`, `/dashboard`, `/projects/**`,
  `/renders/**`) use the editorial kit. The Saltbush kit (Fraunces / Geist /
  clay) is still shipped for legacy internal surfaces; don't add new
  Saltbush surfaces.

## Safety rules

- **Never paste secrets** back in chat, commits, screenshots, or logs.
  If a key has ever appeared anywhere outside `.env.local` / Vercel env vars,
  rotate it immediately.
- **Never commit** `.env.local`, `.env.production`, or anything matching
  `.env*` except `.env.example`.
- **Public sign-ups are currently locked.** myMaison is in closed beta —
  the Supabase Auth dashboard has "Allow new users to sign up" disabled and
  the `/signup` page renders a request-access state unless
  `NEXT_PUBLIC_SIGNUPS_OPEN=true`. Don't re-enable without explicit owner
  approval (see OVERVIEW §2.5 + §7.3).
- **Service role key** is server-only. Never reference
  `SUPABASE_SERVICE_ROLE_KEY` from client components or `NEXT_PUBLIC_*`.
- **Pinterest TOS:** if you touch Pinterest code, never persist pin images
  or URLs. Derive a style profile and store only that signal.

## Working with tasks

The in-session task tool tracks the backlog. Task IDs are referenced in
OVERVIEW §6 (Roadmap). When briefed against a task ID, look up the task,
mark it `in_progress`, and update to `completed` only after typecheck
passes and the work is committed.

## A note on the worktree

The harness sometimes runs commands from a git worktree under
`.claude/worktrees/...`. The actual repo is at
`/Users/sally-anncarydias/Documents/myHome/myhome`. When in doubt, use
absolute paths — both filesystems resolve them correctly. Commit + push
from the main checkout, not the worktree.
