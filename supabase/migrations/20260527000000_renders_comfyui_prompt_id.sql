-- Add comfyui_prompt_id column to renders for Mode C async polling.
--
-- Stage 3a (PR #73) shipped Mode C as a synchronous in-handler render
-- with maxDuration=300s. Stage 3b's multi-pass inpainting workflow
-- routinely exceeds that ceiling (5-7 min per render is the expected
-- warm budget), so the route refactors to the async pattern that
-- fal-ai/kontext-multi already uses: submit + return immediately, poll
-- /api/renders/[id]/status to drive the long-running render to
-- completion server-side.
--
-- This column stores the prompt_id ComfyUI returns from its /prompt
-- endpoint. The status route uses it to look up render progress in
-- /history/{prompt_id} via the tunnel. Conceptually identical to
-- fal_request_id but typed separately because the two providers have
-- different protocols + the status route's polling logic differs.
--
-- Existing renders rows (all currently mode_c or earlier) get NULL.
-- That's fine — those are already finalised (status='succeeded' or
-- 'failed'), so the status route's poll path is never reached for
-- them.

ALTER TABLE renders
  ADD COLUMN IF NOT EXISTS comfyui_prompt_id text;

COMMENT ON COLUMN renders.comfyui_prompt_id IS
  'ComfyUI /prompt response prompt_id. Used by /api/renders/[id]/status to poll /history/{prompt_id} for Mode C renders. Null for non-Mode C renders + for Mode C renders predating PR #77.';
