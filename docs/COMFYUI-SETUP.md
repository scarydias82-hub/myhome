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

## Step 6 — Hand over the tunnel URL to me

Once you've got a working tunnel URL (named or quick), paste it back
to me along with which model option you used (Flux Dev or SDXL).
I'll then ship:

- `lib/comfyui.ts` — API client that submits jobs to your tunnel URL
- `NEXT_PUBLIC_COMFYUI_MODE` feature flag — opt-in routing
- `/api/render` branch — when flag is on, jobs go to ComfyUI
- Polling logic — ComfyUI is async, returns a `prompt_id` you poll
- The actual ControlNet workflow JSON tailored to your model choice

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
