import { z } from 'zod';

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  FAL_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // HuggingFace Inference API token — used in production to embed CLIP
  // vectors when the local @huggingface/transformers binary can't load
  // (e.g. on Vercel serverless). Optional; falls back to local in dev.
  HF_TOKEN: z.string().min(1).optional(),
  // OpenAI API key — used for the gpt-image-1 render path (#176) which
  // is the alternative to Flux Kontext after Kontext multi-image
  // produced collage outputs on product reference input. When unset,
  // /api/render falls through to the Flux Kontext path. Required for
  // FLUX_PROVIDER='openai-image-1'.
  OPENAI_API_KEY: z.string().min(1).optional(),
  // Optional comma-separated allowlist scoping render-pipeline product
  // candidate fetches to a subset of retailers. Used as a temporary
  // test mode — e.g. `RENDER_RETAILER_ALLOWLIST=Coco Republic` to
  // isolate the catalogue while validating new imagery / variants /
  // vision profile coverage. When unset (the production default),
  // every retailer's products are eligible. Applied in:
  //   - lib/curation.ts  (picking-step candidate fetch)
  //   - lib/designer.ts  (narrator candidate fetch)
  //   - lib/matching.ts  (any matcher candidate fetch)
  // Names are matched case-sensitively against `products.retailer`.
  RENDER_RETAILER_ALLOWLIST: z.string().optional(),
  // ComfyUI tunnel URL (Mode C render path — ControlNet-grade room
  // preservation via the owner's Mac M2 Max). Set to the cloudflared
  // tunnel URL exposing the local ComfyUI HTTP server, e.g.
  // https://<words>.trycloudflare.com. When unset, Mode C is
  // unavailable and /api/render falls through to Mode A/B (gpt-image-1).
  // The quick-tunnel URL rotates on cloudflared restart; long-term
  // we'll switch to a named tunnel with a stable hostname. See
  // docs/COMFYUI-SETUP.md.
  COMFYUI_URL: z.string().url().optional(),
  // Shared secret guarding the dev smoke-test route
  // (/api/comfyui-smoketest). The smoke-test endpoint kicks one render
  // through ComfyUI for end-to-end validation without touching the
  // main /api/render path; locking it behind a token stops the
  // endpoint from being a public render-on-demand for anyone who
  // discovers the URL. Set to any high-entropy string and pass via
  // the X-Smoketest-Token header.
  COMFYUI_TEST_TOKEN: z.string().min(8).optional(),
});

// In dev we let the app boot without Supabase so you can render the landing page
// before provisioning the project. Auth code paths check `isSupabaseConfigured`
// and show a "not configured" notice instead of crashing.
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  NEXT_PUBLIC_API_URL: z.string().url().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
  // Mode-B opt-in flag. When set to "true", the new floorplan-confirm +
  // blank-canvas Coco-only flow is enabled in the UI (entry path,
  // restricted palette set, dimension-aware picker, contemporary
  // reference render). When unset / "false" (the production default),
  // the existing photo-restyle flow remains the only flow exposed.
  // See OVERVIEW §6 for the Mode B spec.
  NEXT_PUBLIC_FLOORPLAN_MODE: z.string().optional(),
});

export const publicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_FLOORPLAN_MODE: process.env.NEXT_PUBLIC_FLOORPLAN_MODE,
});

export const isSupabaseConfigured = Boolean(
  publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

// True when the Mode B floorplan-confirm flow is opted in via env var.
// Reads from NEXT_PUBLIC_FLOORPLAN_MODE so the same answer is available
// on the client and the server.
//
// Default flipped 2026-05-26: previously OFF unless env=true (production
// default disabled). Now ON unless env=false explicitly — owner asked
// to unlock Mode B without needing to set the env var in Vercel after
// shipping the full A1-A5 + R1-R4 workstream. To roll back to gated:
// set NEXT_PUBLIC_FLOORPLAN_MODE=false in Vercel.
//
// Mode B degrades gracefully when its supporting data isn't populated
// (Coco lifestyle RAG empty → fallback to room photo as starter; rug
// classification not run → R4 cutout still operates on image_urls[0]).
// So defaulting on is safe even when the manual scripts haven't run.
export const isFloorplanModeEnabled =
  (publicEnv.NEXT_PUBLIC_FLOORPLAN_MODE ?? '').toLowerCase() !== 'false';

export function getServerEnv() {
  return serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_ORG: process.env.SENTRY_ORG,
    SENTRY_PROJECT: process.env.SENTRY_PROJECT,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    FAL_KEY: process.env.FAL_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    HF_TOKEN: process.env.HF_TOKEN,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    RENDER_RETAILER_ALLOWLIST: process.env.RENDER_RETAILER_ALLOWLIST,
    COMFYUI_URL: process.env.COMFYUI_URL,
    COMFYUI_TEST_TOKEN: process.env.COMFYUI_TEST_TOKEN,
  });
}

// Parse RENDER_RETAILER_ALLOWLIST into a string[] of retailer names.
// Empty / unset returns null (meaning "no filter — every retailer
// eligible"). Trims whitespace and drops empty entries so trailing
// commas don't matter.
export function getRenderRetailerAllowlist(): string[] | null {
  const raw = process.env.RENDER_RETAILER_ALLOWLIST;
  if (!raw) return null;
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.length > 0 ? names : null;
}
