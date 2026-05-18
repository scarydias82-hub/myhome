# Design Brief: Saltbush

> **Companion to `BRIEF.md`.** This brief defines the visual design system and per-screen implementation specs. Reference mockup: `design-mockup.html` (open it in a browser to see the four key screens).

---

## 1. Brand & aesthetic direction

**Name (working):** Saltbush — a hardy plant native to the Australian outback. Lowercase wordmark, italic display serif, terminal `.` punctuation in the clay accent colour: *saltbush.*

**Aesthetic positioning:** *Belle* or *Est Living* magazine — not RoomGPT. The category default is generic SaaS (blue gradients, sans-serif, stock photography). We go in the opposite direction: **editorial, Australian, warm, confident, slightly slow.** This is a discretionary lifestyle product for people who care about taste. The interface should signal that we have taste before we render anything.

**Five words to design against:** editorial, warm, considered, Australian, photographic.

**Five words to design *away* from:** SaaS, futuristic, AI-aesthetic, gradient, purple.

---

## 2. Design tokens

### Colour

CSS variables, used everywhere. **No hex codes inline.**

```css
:root {
  /* Surfaces — warm paper, never pure white */
  --paper:       #F4EFE6;  /* primary background */
  --paper-warm:  #ECE4D5;  /* secondary surface (alt sections, cards) */
  --paper-deep:  #DCD0BA;  /* tertiary, rare */
  --cream:       #FBF8F2;  /* card backgrounds on paper */

  /* Ink — off-black, never #000 */
  --ink:         #1B1815;  /* primary text, primary buttons */
  --ink-soft:    #5C5851;  /* secondary text */
  --ink-faint:   #8B847A;  /* tertiary text, meta labels */

  /* Accents */
  --clay:        #B7553C;  /* PRIMARY accent — CTAs, links, brand dot, italic accent text */
  --clay-soft:   #E8C8B7;  /* subtle clay backgrounds */
  --olive:       #5E6A4D;  /* secondary accent, used sparingly */
  --gold:        #A6824A;  /* tertiary, premium states */

  /* Lines */
  --line:        rgba(27, 24, 21, 0.12);
  --line-soft:   rgba(27, 24, 21, 0.06);
}
```

**Rules:**
- Background is `--paper`, never white. Pure white is jarring in this system.
- Body text is `--ink` (not pure black).
- Clay is *the* accent. It should appear in every screen at least once, but never dominate.
- Olive is reserved for status indicators ("in stock", success).
- No new colours without proposing them as additions to the system.

### Typography

Two fonts only. **No Inter. No Roboto. No system fonts.**

- **Display:** Fraunces (Google Fonts) — variable, optical-sizing aware. Weight 300 default, occasional 400. Italic variant used heavily for editorial emphasis (within headlines, on key brand moments).
- **Body / UI:** Geist (Google Fonts) — Vercel's grotesque. Weight 400 body, 500 buttons & emphasis, 600 sparingly.
- **Mono (labels, prices, technical meta):** Geist Mono — weight 400, uppercase with letter-spacing for small labels.

Load with `display=swap`:

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Geist:wght@300..700&family=Geist+Mono:wght@300..600&display=swap" rel="stylesheet">
```

**Type scale (desktop):**

| Use | Font | Weight | Size | Tracking | Line-height |
|---|---|---|---|---|---|
| Display 1 (hero) | Fraunces | 300 | clamp(48px, 5.4vw, 78px) | -0.025em | 0.98 |
| Display 2 (section) | Fraunces | 300 | 52px | -0.02em | 1.02 |
| Display 3 (card title) | Fraunces | 400 | 22–30px | -0.01em | 1.1 |
| Body large | Geist | 400 | 18px | 0 | 1.55 |
| Body | Geist | 400 | 15px | 0 | 1.5 |
| Meta / label | Geist Mono | 400 | 11px | 0.12–0.16em, uppercase | 1.3 |
| Price | Geist Mono | 500 | 14px | 0 | 1 |

**Italic rule:** Fraunces italic is used to highlight ONE word per display headline, always in `--clay`. Like a magazine pull-quote. Example: `Your room, styled like a magazine.` where *magazine* is italic clay.

### Spacing & layout

- Container max-width: 1320px desktop. Side padding: 56px desktop, 24px tablet, 16px mobile.
- Section vertical padding: 80–110px desktop, 56px mobile.
- Border radii: `--r-sm: 4px` (thumbs), `--r-md: 10px` (cards), `--r-lg: 18px` (large surfaces), `--r-xl: 28px` (page-level).
- Buttons: pill (999px radius). No rectangular buttons except the picking-list CTA which is a wide pill.

### Texture & atmosphere

- Apply a **subtle 4px dot grain** to large `--paper` surfaces:
  ```css
  background-image: radial-gradient(circle at 1px 1px, rgba(27,24,21,0.025) 1px, transparent 0);
  background-size: 4px 4px;
  ```
- Shadows are warm and soft: `0 24px 60px -20px rgba(0,0,0,0.18)`. Never harsh blacks.
- No gradients on UI surfaces (gradients are reserved for actual image placeholders).

---

## 3. Component patterns

These are derived from the mockup. Implement once in shadcn/ui customizations, reuse everywhere.

### Logo / wordmark
- Fraunces italic 300, with `.` after in `--clay`. Always lowercase. Pairs with the brand name at all sizes.

### Buttons
- **Primary:** ink background, cream text, pill, 14px Geist 500, hover transitions to clay.
- **Secondary:** transparent with 1px `--line` border, hover fills to ink.
- **CTA (large):** ink pill, 18px padding, includes a small cream circular arrow icon on the right.
- **Pinterest connect:** brand red `#E60023`, white text, white circular icon-mark on the left.

### Eyebrow labels
- Geist Mono 11px, uppercase, 0.14em tracking, colour `--clay` or `--ink-faint`. Prefixed with a 24px `--clay` 1px rule. Used on every section.

### Cards
- `--cream` background on `--paper` parent, 1px `--line-soft` border, 28px padding, `--r-lg` radius.

### Tags / pills (overlay)
- White pill with charcoal text, drop-shadow, used to label items in renders. 11px Geist 500.

### Hotspots (on rendered image)
- 28px cream circle, 2px `--clay` border, 8px clay dot centre. Hover scales 1.15. Active state inverts (clay fill, cream dot).

### Item card (picking list)
- 76px square thumbnail + info column. Hover shifts left 4px. Active/featured state has `--paper-warm` background and rounded corners.

---

## 4. Screen-by-screen specs

### Screen 01 — Landing

**Sections (in order):**

1. **Nav** — sticky, 28px vertical padding, paper background, `--line-soft` bottom border. Logo left, 4 links centre-right, primary "Start free" pill far right.
2. **Hero** — 60/40 split, 80px top padding, 100px bottom. Left: eyebrow, big display headline with italic clay word, sub-paragraph (max 480px), CTA, meta line ("Free to try · 3 renders included · No card required"). Right: composed visual — two rotated room cards with product tags overlaid (described below).
3. **Retailer strip** — `--paper-warm` band, mono label left + retailer wordmarks. Real retailers when partnerships land; placeholder type until then.
4. **How it works** — three numbered steps. Number is large Fraunces italic clay. 1px line divider beneath. Title (Fraunces 24px) + description (Geist 15px ink-soft).
5. **Quote** — full-bleed `--paper-warm`. Italic Fraunces blockquote 38px, centred, max 900px. Attribution in mono.
6. **Footer** — minimal, mono small caps. Two lines: copyright + nav links.

**Hero visual implementation:** Use two `<div class="room-card">` elements with rotation transforms and gradient backgrounds as photo stand-ins. **Replace with actual interior photography once we have it** — these are mockup-only.

### Screen 02 — Onboarding (Pinterest connect)

- 50/50 split, full viewport height minus nav.
- **Left half:** progress indicator (4 dashes, current is wider + clay), display headline with italic clay accent ("Show us your *taste*."), explanation paragraph, red Pinterest CTA, "or pick from curated styles instead →" skip link in `--ink-soft`, then a **privacy note callout** with a 2px clay left border explaining how we handle their pin data. This callout is required for trust and policy compliance.
- **Right half:** `--paper-warm` background. A 3-column masonry of 6 gradient "pins" rotated -5deg. Below, a centred white pill showing five colour swatches with the label "Detected palette" — implies "we read your aesthetic."

### Screen 03 — Render result with picking list (the hero moment)

This is the page that sells the product. Everything else exists to get the user here. Spend disproportionate polish budget here.

- **Top app nav:** cream background, 20px padding, logo + nav links (My rooms / This render active / Saved products / Style profile) + circular avatar in clay→gold gradient.
- **Result header:** breadcrumb (mono uppercase) + page title with italic clay style name ("Living room — *Warm Japandi*"). Right side: 4 action pills (Download / Share / Try another / Save).
- **Two-column grid:** 1fr render canvas + 420px fixed-width picking sidebar, 32px gap.

**Render canvas:**
- 16:11 aspect ratio, `--r-lg` radius, soft drop shadow.
- Top-left: before/after/split toggle (Before, After active, Split). Backdrop-blur dark glass pill.
- 4 hotspots overlaid at item positions (sofa, table, art, lamp). Tappable; one is in active state by default.
- Bottom-right meta in mono: "Rendered in 38s" + seed/model line for transparency.

**Picking list sidebar (`--cream` card, 28px padding):**
- Header: style name with italic clay word, source line in mono ("From "calm mornings" · Pinterest board"), 5-swatch palette strip.
- Section label: "The picking list" + clay count "8 items".
- Item cards: 76px thumbnail + info. Featured/active card has `--paper-warm` background indicating "this is the currently selected hotspot." Other cards are plain rows. Each shows: category mono label, product name (Fraunces 16px), retailer (Geist 12px ink-soft), price (Geist Mono 14px 500), "+ N alternatives" link.
- **Total block** at bottom: 1px solid `--ink` top border (heavier than rest), "Estimated total" mono label + big italic clay amount in Fraunces 32px ("**$5,847**"). Full-width ink pill CTA: "Open all 4 retailer tabs →". Below: tiny disclosure line (ACL compliance — "Some links earn Saltbush a commission at no extra cost to you.").

**Interaction logic to implement:**
- Click hotspot on render → corresponding picking-list item scrolls into view & becomes featured/highlighted.
- Click item in picking list → corresponding hotspot pulses on render.
- "+ N alternatives" link → opens a horizontal carousel of alternative products in a drawer.
- "Try another style" → returns to style picker.

### Screen 04 — Dashboard / My Rooms

- App nav (logged in).
- Dashboard header: mono greeting line ("Welcome back, Maya") above big Fraunces "Your *rooms*." (italic clay). Right side: ink pill "+ Style a new room" with circular plus icon.
- Tabs row: All / Living / Bedroom / Kitchen / Bathroom / Outdoor with item counts in mono. Active tab has clay underline.
- **Magazine grid:** 12-column grid. First row: featured tile spans 7 cols + standard spans 5. Second row onwards: three tiles each spanning 4 cols. Featured tile has 16:9 image and bigger Fraunces title with italic clay subline. Each tile: render image with bottom-left dark glass badge ("Warm Japandi · 8 items · $5,847"), title, meta row (last-styled date + render count in mono).

---

## 5. Animation principles

Restrained, editorial pacing — not bouncy SaaS micro-interactions.

- **Page load:** staggered fade + 8px y-translate. Header → hero text → hero visual → below-fold. Total ~600ms.
- **Hover on cards:** 4px y-translate, 300ms ease-out. Subtle.
- **Buttons:** background colour transitions 200ms. No bouncy scales.
- **Hotspot active state:** pulse animation (1.2 scale, 1s loop) for the currently selected hotspot only.
- **Render reveal:** when restyling completes, fade in over ~500ms with a subtle scale from 0.98. Then trigger hotspots appearing in a 100ms stagger.
- **Page transitions:** 200ms fade between routes. No slide-ins.

Use Motion (formerly Framer Motion) for React animations. CSS for hover/transition states.

---

## 6. Mobile considerations

The result-page experience is critical on mobile (camera capture is mobile-first).

- **Mobile breakpoint:** 768px.
- **Result page on mobile:** stack render above picking list. Picking list becomes a swipe-up bottom sheet (peek state shows total + first item; expanded shows all items). Hotspots remain tappable on the render.
- **Camera capture:** use `<input type="file" accept="image/*" capture="environment">` for MVP. Native camera UX is a Phase 2 concern.
- **Type scale on mobile:** Display 1 → 44px, Display 2 → 36px, body unchanged.
- **Touch targets:** minimum 44×44px. Buttons get extra padding on mobile.

---

## 7. Accessibility

Non-negotiable:

- All interactive elements keyboard-navigable. Visible focus states using a 2px `--clay` outline with 2px offset.
- Colour contrast: `--ink` on `--paper` is ~13:1 (excellent). Verify any clay-on-paper text passes 4.5:1 (it does for body, marginal for thin display weights — use clay only on large display type or use `--ink` for clay-coloured text under 18px).
- Alt text on every rendered image describing the room + style + key items.
- `prefers-reduced-motion` honoured — disable all transforms and reveal animations.
- Picking list keyboard-navigable: arrow keys move between items, Enter opens alternatives.

---

## 8. Imagery guidance

The mockup uses gradient placeholders. In production:

- **Before/after photography:** invest in commissioning 8–10 real Australian rooms (before) + commissioning real stylists to redress them (after) for the marketing site. Generic stock photography will undermine the editorial positioning.
- **Render imagery in product:** comes from the generation pipeline. Quality is governed by Section 4 of the technical brief.
- **Pin grid on onboarding:** when Pinterest is connected, show real fetched pins (but do not persist them — see policy note in technical brief).
- **No icons except a small set:** arrows, plus, close, share. Use [Phosphor Icons](https://phosphoricons.com) "regular" weight, sized 18–20px, in `--ink` or `--clay`. **No multicoloured emoji icons.**

---

## 9. Components to build (M0–M1 priority list)

These are the shadcn/ui customisations Claude Code should create first, in `apps/web/components/`:

1. `<Logo />` — wordmark with clay dot
2. `<Button variant="primary|secondary|cta" />` — pill buttons with arrow icon support
3. `<Eyebrow />` — small clay mono label with leading rule
4. `<DisplayHeading level={1|2|3} />` — Fraunces with italic-accent slot
5. `<Card />` — cream background, line-soft border, 28px padding
6. `<ItemCard />` — picking-list row with featured state
7. `<Hotspot />` — overlay dot with active/inactive states
8. `<PaletteStrip />` — circular swatch row
9. `<Pill />` — small white/ink pill for tags + actions
10. `<BeforeAfterToggle />` — segmented control over imagery
11. `<NavApp />` — logged-in nav with avatar
12. `<NavMarketing />` — public nav with CTA
13. `<PrivacyCallout />` — left-border note block
14. `<ProgressDashes />` — onboarding progress

---

## 10. First design-build task for Claude Code

After M0 (skeleton) is done, before M1 (render pipeline), spend a half-day on the foundation:

> "Read `DESIGN-BRIEF.md` and look at `design-mockup.html` in `docs/`. Set up the design system: add Fraunces + Geist from Google Fonts to the Next.js root layout. Configure Tailwind with the colour tokens and font families from Section 2. Add the 4px grain pattern as a Tailwind utility. Build the components in Section 9 (1–8 first) in `apps/web/components/`. Build a `/design-system` route that demos all components on one page so we can verify them. Commit each component as its own atomic commit."

---

## 11. Things to revisit with real photography

- Hero visual on landing needs real before/after photos, not gradients.
- Retailer logos need actual SVG marks once partnerships are live.
- Sample renders for "Sample looks" page (not in current mockup) — needs ~12 hero examples across room types and styles.
- Founder portrait + journal photography if we add a `/journal` content section.

---

*End of design brief. Pair with `BRIEF.md` for tech stack and milestones, and `design-mockup.html` for visual reference.*
