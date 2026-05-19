# myMaison eval harness

A scripted way to iterate on render quality without manually submitting
renders through the UI and describing what looked wrong. Each run:

1. Loads each fixture (a room photo + style + palette combination)
2. Runs the full pipeline — room analysis, designer critique, Flux
   render, picking list (detection + validation + matching)
3. Scores the result with a Claude Sonnet vision pass on six criteria
4. Writes a structured scorecard + an aggregate Markdown report

Share the Markdown with Claude Code. Claude makes one code or config
change (Flux strength, canny lock, validator prompt, etc.), you re-run,
compare. Converges in 10–20 cycles vs the 50+ ad-hoc renders we'd need
otherwise.

---

## Setup

### 1. Drop fixture photos into `fixtures/`

Put real room photos (JPG/PNG) into `apps/web/scripts/eval/fixtures/`.
At least 3 covering different room types is the minimum useful set:

```
fixtures/
  bedroom-upstairs.jpg
  living-room-warm.jpg
  kitchen-bright.jpg
```

Files in this directory are gitignored.

### 2. Register them in `fixtures.ts`

Edit `fixtures.ts` and add a row per file with the style + palette
each should be tested against. Multiple rows per file = same image
tested against multiple configurations.

### 3. Set EVAL_USER_ID in `.env.local`

The harness uses the service-role Supabase client to create room rows.
RLS requires a user_id. Use the UUID of any account you've manually
provisioned (the closed-beta user is fine — find their UUID in
Supabase Studio → Authentication → Users).

```bash
# Add to apps/web/.env.local
EVAL_USER_ID=00000000-0000-0000-0000-000000000000
```

---

## Running

From the repo root:

```bash
# One fixture, current config
pnpm --filter web exec tsx scripts/eval/run.ts --fixture bedroom-upstairs

# All fixtures, current config (the normal cycle)
pnpm --filter web exec tsx scripts/eval/run.ts --all

# Skip the evaluator pass (just generate renders, no scoring)
pnpm --filter web exec tsx scripts/eval/run.ts --all --no-score
```

Outputs land in `results/<timestamp>/`:

```
results/2026-05-19T14-23-01/
  summary.md              ← the report to share with Claude Code
  results.json            ← machine-readable per-fixture data
  bedroom-upstairs/
    original.jpg
    rendered.jpg          ← what fal returned
    room-analysis.json
    designer-read.json
    picking-list.json
    scorecard.json
```

`results/` is gitignored. Keep what you need for comparison runs.

---

## Cost per run

Per fixture:
- Vision analysis: ~$0.003 (Claude Haiku)
- Designer critique: ~$0.015 (Claude Sonnet vision)
- Flux render: ~$0.03 (fal flux-control-lora-canny)
- Detection × 2: ~$0.005 (Florence-2)
- Validator + ranker × N items: ~$0.01
- **Evaluator: ~$0.02 (Claude Sonnet vision)**
- **Total: ~$0.08 per fixture**

5 fixtures = ~$0.40 per run. 20 iteration cycles = ~$8.

Wall-time: ~60 seconds per fixture (mostly Flux). 5 fixtures sequential
= ~5 minutes.

---

## How to share with Claude Code

After a run finishes, send:

> "Eval ran. Aggregate scores: [summary.md]"

Plus paste the **Aggregate scores** section + the **Common failure
patterns** section from `summary.md`. Claude reads that, proposes one
config change, you accept + re-run.

Don't share `results.json` — too noisy. The Markdown summary is curated.
