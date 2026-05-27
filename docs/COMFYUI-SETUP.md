# ComfyUI on Mac M2 Max — setup for myMaison's render fidelity path

The strategic context: gpt-image-1 can't reliably preserve room
geometry + swap furniture at the same time (see OVERVIEW changelog
2026-05-26 for the prompt-engineering ceiling story). The proper
fix is **ControlNet Depth + Inpainting**, which locks the geometry
constraint at the model level rather than asking the LLM nicely to
preserve it. That's what this doc walks you through setting up.

Once the setup here is complete, the integration code (`lib/comfyui.ts`
+ feature flag) ships separately — we want ComfyUI rendering locally
before we wire Vercel to it.

## Hardware target

This guide assumes a MacBook Pro with **M2 Max + 38-core GPU**. The
choice of model (Flux vs SDXL) depends on your unified RAM:

- **96GB / 64GB unified RAM**: Flux Dev (12B params). Best quality.
  ~90-180s per 1024×1024 render with ControlNet.
- **32GB unified RAM**: SDXL + ControlNet. Reliable on Mac. ~25-60s
  per render. Slightly weaker but tested + stable.

Decide which tier before downloading — the model weights are large
(Flux Dev is ~24GB, SDXL is ~7GB) and you don't want to bounce.

---

## Step 1 — Install ComfyUI

```bash
cd ~/Documents
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
```

Set up Python (Apple Silicon needs Python 3.11 or 3.12; 3.13 has
torch-wheel issues at time of writing). If you don't have a recent
python:

```bash
brew install python@3.12
python3.12 -m venv venv
source venv/bin/activate
```

Install PyTorch with **MPS support** (Apple's Metal backend):

```bash
pip install --upgrade pip
pip install torch torchvision torchaudio
pip install -r requirements.txt
```

Verify MPS is detected:

```bash
python -c "import torch; print('MPS available:', torch.backends.mps.is_available())"
# Expected: MPS available: True
```

---

## Step 2 — Download model weights

### Option A — Flux Dev (64GB+ RAM)

Models to download (place in `ComfyUI/models/<subdir>/`):

| File | Where | Size | Source |
|---|---|---|---|
| `flux1-dev.safetensors` | `models/unet/` | ~24GB | huggingface.co/black-forest-labs/FLUX.1-dev |
| `ae.safetensors` | `models/vae/` | ~330MB | huggingface.co/black-forest-labs/FLUX.1-dev |
| `clip_l.safetensors` | `models/clip/` | ~250MB | huggingface.co/comfyanonymous/flux_text_encoders |
| `t5xxl_fp8_e4m3fn.safetensors` | `models/clip/` | ~4.9GB | same as above |
| `flux-depth-controlnet-v3.safetensors` | `models/controlnet/` | ~6.6GB | huggingface.co/XLabs-AI/flux-controlnet-collections |

You'll need a Hugging Face account + an access token to download
the Flux files (they're gated behind a license click). Get the token
from huggingface.co/settings/tokens, then:

```bash
pip install -U "huggingface_hub[cli]"
huggingface-cli login
# paste token when prompted
huggingface-cli download black-forest-labs/FLUX.1-dev flux1-dev.safetensors --local-dir ./models/unet --local-dir-use-symlinks False
# ... etc
```

### Option B — SDXL (32GB RAM)

| File | Where | Size | Source |
|---|---|---|---|
| `sd_xl_base_1.0.safetensors` | `models/checkpoints/` | ~6.9GB | huggingface.co/stabilityai/stable-diffusion-xl-base-1.0 |
| `control_v11p_sdxl_depth.safetensors` | `models/controlnet/` | ~2.5GB | huggingface.co/diffusers/controlnet-depth-sdxl-1.0 |
| `control_v11p_sdxl_inpaint.safetensors` | `models/controlnet/` | ~2.5GB | huggingface.co/destitech/controlnet-inpaint-dreamer-sdxl |

SDXL doesn't need HF auth. Direct downloads work.

### Both options also need an inpainting model

For the "swap only the sofa region, keep walls" behaviour:

| File | Where | Size |
|---|---|---|
| `sam_vit_b_01ec64.pth` (Segment Anything) | `models/sams/` | ~358MB |
| `depth_anything_v2_vitl.pth` | `models/depthanything/` | ~1.3GB |

These two enable automatic depth + mask generation per render.

---

## Step 3 — Install required custom nodes

ComfyUI uses a plugin system. We need three plugins:

```bash
cd ~/Documents/ComfyUI/custom_nodes
git clone https://github.com/ltdrdata/ComfyUI-Manager
git clone https://github.com/Fannovel16/comfyui_controlnet_aux
git clone https://github.com/ltdrdata/ComfyUI-Impact-Pack
```

Restart ComfyUI after pulling these (Manager handles dependency
installs on first launch).

---

## Step 4 — Launch ComfyUI

From the ComfyUI root:

```bash
source venv/bin/activate
python main.py --listen 0.0.0.0
```

- `--listen 0.0.0.0` exposes ComfyUI on your local network. Without
  this, only `localhost` access works (fine for first-test, mandatory
  for Cloudflare Tunnel step later).

Open `http://localhost:8188` in a browser. You should see the
ComfyUI canvas.

### Smoke test

In ComfyUI:
1. Click `Load Default` (top right) to load the basic SD workflow
2. Click `Queue Prompt`
3. Within ~30-90s you should see an image render

If this works, your stack is functional. Send the resulting image
file to confirm. If it errors, paste the terminal output back to me
and I'll diagnose.

---

## Step 5 — Cloudflare Tunnel (for myMaison integration)

Once ComfyUI is rendering locally, we need to expose it to Vercel
without you running a static IP / port forwarding.

```bash
brew install cloudflared
```

Create a tunnel (you'll need a Cloudflare account; the free tier
is sufficient):

```bash
cloudflared tunnel login
# opens browser, click your domain or use *.trycloudflare.com if you
# don't have a domain configured

cloudflared tunnel create mymaison-comfyui
# note the tunnel ID
```

Configure routing (`~/.cloudflared/config.yml`):

```yaml
tunnel: <tunnel-id-from-previous-step>
credentials-file: /Users/<your-username>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: comfyui.yourdomain.com  # or use quick-tunnel below
    service: http://localhost:8188
  - service: http_status:404
```

Start the tunnel:

```bash
cloudflared tunnel run mymaison-comfyui
```

**Quick alternative (no domain)** — for testing, use a `*.trycloudflare.com` URL:

```bash
cloudflared tunnel --url http://localhost:8188
# prints a random URL like https://random-words.trycloudflare.com
```

These quick-tunnels rotate URLs on restart; use a named tunnel for
anything beyond testing.

---

## Step 6 — Smoke test the integration (Stage 1)

`lib/comfyui.ts` + the `/api/comfyui-smoketest` route ship in PR #71.
They hit your tunnel to validate the full wire-up — upload image →
submit workflow → poll → fetch output — using a plain SDXL img2img
workflow (no ControlNet yet; Stage 2 adds Depth + Inpaint).

### Set env vars

In `apps/web/.env.local`:

```bash
COMFYUI_URL=https://<your-tunnel-words>.trycloudflare.com
COMFYUI_TEST_TOKEN=<any high-entropy string, e.g. `openssl rand -hex 32`>
```

### Run the smoke test

In one terminal, start the Next.js dev server:

```bash
pnpm --filter web dev
```

In another, curl the endpoint with any room photo:

```bash
curl -X POST 'http://localhost:3000/api/comfyui-smoketest' \
  -H "X-Smoketest-Token: ${COMFYUI_TEST_TOKEN}" \
  -F 'photo=@/path/to/your/room.jpg' \
  -F 'prompt=a modern contemporary living room with warm natural light, editorial interior photography' \
  -F 'denoise=0.7' \
  --output result.png \
  -i
```

The `-i` flag shows response headers including `X-ComfyUI-Prompt-Id`
and `X-ComfyUI-Duration-Ms`. First render takes 70-90s warm,
3-5 min cold (MPS kernel compile). `result.png` lands in your CWD.

If it errors, the JSON body explains why — most common:
- `COMFYUI_URL not set` → check `.env.local`
- `ComfyUI /prompt failed: 400 — ...node_errors...` → workflow JSON
  shape doesn't match what ComfyUI expects (e.g. checkpoint filename
  doesn't match what's in your `models/checkpoints/` folder)
- `ComfyUI render timed out after 300000ms` → Mac asleep, tunnel
  down, or the workflow is hung
- `ComfyUI execution error for prompt … convolution_overrideable not
  implemented` → PyTorch 2.12 + ComfyUI 0.22 MPS VAE bug; restart
  ComfyUI with `--cpu-vae` (see Lessons from the Stage 1 smoke test
  below)

### The 2026-05-27 setup arc (lessons memo'd)

Burned a few hours getting the first end-to-end render through.
Final working configuration on the owner's 32GB M2 Max:

- **PyTorch 2.6.0** (NOT 2.12 — see lesson 1 below)
- **torchvision 0.21.0**, **torchaudio 2.6.0** (must match torch ABI)
- **comfyui_controlnet_aux** custom node installed with **onnxruntime**
  (CPU build) instead of `onnxruntime-gpu` (CUDA-only, no macOS wheel)
- ComfyUI launched **without `--cpu-vae`** — MPS VAE works fine on 2.6
- 1024×1024 native SDXL with Depth ControlNet runs in ~30-90s, no OOM

The reset command if it ever drifts:

```bash
cd ~/Documents/ComfyUI && source venv/bin/activate
pip install --force-reinstall "torch==2.6.0" "torchvision==0.21.0" "torchaudio==2.6.0"
# (comfyui_controlnet_aux deps stay as-is)
python main.py --listen 0.0.0.0
```

### Specific bugs we hit (so we never re-fight them)

1. **MPS VAE encode is broken on PyTorch 2.12 + ComfyUI 0.22.**
   `NotImplementedError: convolution_overrideable not implemented`
   in the VAE encode path. Two paths out:
   - **Recommended**: downgrade to PyTorch 2.6 (lesson above). MPS
     coverage is much more complete there.
   - **Fallback** (only if you can't downgrade torch): launch ComfyUI
     with `--cpu-vae` so the encoder/decoder run on CPU. Forces a
     512px ceiling on a 32GB Mac due to CPU activation memory.

2. **CVE-2025-32434 forces torch ≥ 2.6 for `.pth` files.**
   MiDaS ships as `.pth`, so `comfyui_controlnet_aux`'s depth
   preprocessor refuses to load on older torch versions. PyTorch 2.5
   passes the MPS VAE bug but fails the CVE check; PyTorch 2.6 is
   the floor that satisfies both.

3. **`onnxruntime-gpu` has no macOS-ARM wheel.** When installing
   `comfyui_controlnet_aux` requirements:
   ```bash
   grep -v 'onnxruntime-gpu' requirements.txt > /tmp/req-mac.txt
   pip install -r /tmp/req-mac.txt && pip install onnxruntime
   ```

4. **Input resolution ceiling drops to 512×512 with `--cpu-vae`.**
   Only relevant if you're stuck on torch 2.12 and need the
   `--cpu-vae` workaround. CPU VAE encode of a full-res phone photo
   pushes past 32GB unified RAM → `zsh: killed`. The
   `buildModeCDepthWorkflow` ImageScale node defaults to 1024 but
   can be overridden to 512.

3. **DNS hiccups during long polls used to kill the script.** Now
   patched — `lib/comfyui.ts`'s `pollHistory` + `fetchComfyUIOutput`
   use `fetchWithRetry` with 3 retries and exponential backoff. A
   single DNS drop (common when the Mac flips between Wi-Fi and
   LTE) no longer aborts a 5-minute render.

4. **Error states used to poll forever.** Now patched — `pollHistory`
   detects `status_str === 'error'` and throws `ComfyUIExecutionError`
   with the ComfyUI-side traceback surfaced. Previously the poll
   only checked `completed === true` and would tick uselessly for
   30+ minutes on jobs that errored in 0.45s.

5. **SDXL output quality at 512×512 is noticeably worse than at
   1024×1024.** Expected — SDXL was trained on 1024 natively.
   Mode C's full quality story needs either:
   - A box with proper GPU (e.g. RTX 5090, 32GB VRAM), where the
     1024×1024 ceiling lifts to Flux Dev resolution; or
   - The 96GB M2 Max tier (Flux Dev fits in unified RAM at 1024
     with `--cpu-vae` headroom)

### Stage 2 ships (workflow builder + client polish)

`lib/comfyui-workflows.ts` now exports `buildModeCDepthWorkflow()`
in addition to the Stage 1 `buildImg2ImgWorkflow()`. The depth
workflow adds three nodes — MiDaS depth preprocessor, ControlNet
loader, ControlNet apply — onto the img2img graph and wires them
into the KSampler's conditioning pair.

Smoke-test the Stage 2 path with `mode=depth`:

```bash
curl -X POST 'http://localhost:3000/api/comfyui-smoketest' \
  -H "X-Smoketest-Token: ${COMFYUI_TEST_TOKEN}" \
  -F 'photo=@/path/to/your/room.jpg' \
  -F 'prompt=a modern contemporary living room with warm natural light' \
  -F 'denoise=0.65' \
  -F 'maxLongSide=512' \
  -F 'mode=depth' \
  -F 'controlnetStrength=1.0' \
  --output result-depth.png \
  -i
```

First Stage 2 call also downloads MiDaS weights (~1.3GB) on first
use — bump the total budget to ~8 minutes for the cold case. The
SDXL Depth ControlNet (`control_v11p_sdxl_depth.safetensors`)
should already be in `~/Documents/ComfyUI/models/controlnet/` per
Step 2 Option B above.

A/B comparison: run the same prompt with and without `mode=depth`.
The depth variant should preserve walls, window placement, ceiling
height, and large furniture silhouettes; the plain img2img variant
will drift them.

### Stage 2 pre-reqs (optional — for Stage 3 inpainting)

Stage 3 adds per-product inpainting, which needs Segment Anything
to derive masks. Optional to download now:

```bash
cd ~/Documents/ComfyUI/models
mkdir -p sams
# Segment Anything ViT-B — ~358MB
hf download ybelkada/segment-anything \
  checkpoints/sam_vit_b_01ec64.pth \
  --local-dir ./sams
```

---

## Realistic gotchas

1. **First Flux render takes 5-10 minutes** as MPS compiles the
   kernels. Subsequent renders are 90-180s. Don't panic on the first one.
2. **Memory fragmentation** — restart ComfyUI every ~20 renders. MPS
   has a known leak on extended sessions.
3. **macOS sleep kills the tunnel** — System Settings → Battery →
   set "Prevent automatic sleeping when display is off". Otherwise
   renders fail when you close the lid.
4. **Custom-node compatibility** — some ComfyUI nodes assume CUDA.
   ControlNet Aux and Impact Pack both have MPS paths; if you grab
   a workflow from civitai.com and it references a CUDA-only node,
   we'll need to swap.

---

## What this UNBLOCKS in myMaison

Once running and tunneled, the render fidelity story becomes:

- **Mode A (photo-restyle)** keeps using gpt-image-1 by default
  (fast, "mood-board" quality)
- **Mode B (blank canvas)** keeps using gpt-image-1 (no existing
  geometry to preserve, gpt-image-1 is fine)
- **Mode C (new)** routes to ComfyUI via your Mac when
  `NEXT_PUBLIC_COMFYUI_MODE=true`. Slower (~2-3 min per render) but
  preserves walls exactly + swaps furniture per Depth/Inpaint
  constraints

You can A/B between modes per render via a UI toggle once Mode C
is wired up. The integration code is ~half a day of work once your
tunnel is up.
