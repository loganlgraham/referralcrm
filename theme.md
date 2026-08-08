# ReferralCRM — Theme Handoff

**Goal:** re-skin the existing dashboard with a new visual theme. **No layout or component-structure changes required** — this is a token + typography swap.

**Repo:** `loganlgraham/referralcrm` (branch `main`)
**Target theme:** "Workspace" — bright porcelain surfaces, vivid **indigo** accent, `Manrope`, softly rounded cards.

---

## Why this is a small change

The app is already fully tokenized. `src/app/globals.css` declares semantic design tokens as **HSL triplets** in `:root`, and `tailwind.config.ts` maps them to utility classes (`bg-surface`, `text-foreground-muted`, `border-strong`, `bg-primary`, etc.). Components consume the tokens, never raw hex.

**So: change the tokens, and the whole UI re-themes.** Do not touch component files unless a step below says to.

---

## 1. Font

Swap the sans stack from Inter to **Manrope**.

- Wherever the Inter font is loaded (`src/app/layout.tsx`, likely `next/font/google`), replace `Inter` with `Manrope` (weights 400/500/600/700/800).
- Keep the `--font-sans` CSS variable wiring intact; only the family behind it changes.
- In `globals.css`, update `--font-sans: 'Manrope', sans-serif;`.

## 2. Tokens — edit `:root` in `src/app/globals.css`

Replace the existing values with these (format is unchanged: `H S% L%`).

```css
:root {
  --font-sans: 'Manrope', sans-serif;

  /* Surfaces */
  --surface: 0 0% 100%;         /* #FFFFFF cards / panels */
  --surface-raised: 0 0% 100%;
  --surface-muted: 228 33% 97%; /* #F5F6FA app background */
  --surface-subtle: 227 33% 95%;/* #EEF0F7 search fields, chips */

  /* Borders */
  --border: 224 25% 90%;        /* #DFE3EE hairlines */
  --border-strong: 226 22% 84%; /* #CDD2E2 buttons, dividers */

  /* Text */
  --text: 230 27% 13%;          /* #181B2A headings/body */
  --text-muted: 226 15% 41%;    /* #5A6178 secondary */
  --text-subtle: 224 15% 59%;   /* #8890A6 meta/labels */

  /* Primary = indigo accent */
  --primary: 242 71% 57%;       /* #4B45E0 */
  --primary-foreground: 0 0% 100%;
  --ring: 242 71% 57%;

  /* Semantic status (retuned to sit with indigo) */
  --success: 152 45% 34%;  --success-foreground: 0 0% 100%;  --success-soft: 152 40% 94%;
  --warning: 33 78% 43%;   --warning-foreground: 30 100% 8%; --warning-soft: 40 90% 93%;
  --danger:  340 68% 45%;  --danger-foreground: 0 0% 100%;   --danger-soft: 340 70% 96%;
  --info:    242 71% 57%;  --info-foreground: 0 0% 100%;     --info-soft: 242 60% 95%;
}
```

Notes:
- `primary-50…900` in `tailwind.config.ts` is a hardcoded **gray** ramp left over from the old slate brand. If any component uses `bg-primary-600` / `text-primary-700` as the accent (not as neutral gray), retint that ramp toward indigo. If those classes are only used as neutrals, leave them.
- The default `a` styling in `globals.css` underlines links in `--text`. Workspace uses accent-colored, non-underlined links — change the base `a` rule to `color: hsl(var(--primary)); text-decoration: none;` and keep an underline on `:hover` if you prefer.

## 3. Shape & shadow — `tailwind.config.ts`

Workspace is rounder and softer.

```ts
borderRadius: { card: '16px', pill: '9999px' },
boxShadow: {
  card:   '0 1px 2px rgba(20,20,60,0.04), 0 10px 30px -14px rgba(20,20,60,0.14)',
  raised: '0 4px 14px rgba(20,20,60,0.06), 0 24px 48px -18px rgba(20,20,60,0.20)',
  focus:  '0 0 0 4px hsl(var(--ring) / 0.22)',
},
```

## 4. Accent-soft helper (optional but recommended)

Workspace uses a pale indigo wash for the active nav item, selected list row, and the "Next step" callout. Add a token so it's reusable:

```css
--primary-soft: 242 60% 95%;  /* #E6E4FB */
```
Map it in `tailwind.config.ts` under `primary` as `soft: 'hsl(var(--primary-soft) / <alpha-value>)'`, then use `bg-primary-soft text-primary` for those states.

---

## Acceptance checklist

- [ ] App background reads as cool porcelain `#F5F6FA`; cards are pure white with soft shadows.
- [ ] All accent affordances (primary buttons, active nav, focus ring, links) are indigo `#4B45E0`.
- [ ] Body/UI font is Manrope everywhere; no Inter left in the bundle.
- [ ] Cards/inputs use the larger 16px radius; shadows are soft, not hard.
- [ ] Success/warning/danger badges still pass contrast against their `-soft` backgrounds.
- [ ] No component `.tsx` structure changed beyond the font import and (if needed) the primary ramp / link rule.

---

## Appendix — alternate palettes (same procedure, swap the block in step 2)

If the team prefers a different direction, only the token block changes; steps 1/3/4 adjust as noted.

### A. "Command Deck" — dark graphite, electric mint
Dark mode. Set `color-scheme: dark`, dark surfaces, mint accent. Font: `Space Grotesk` (UI) + `IBM Plex Mono` (numerics).
```css
--surface: 220 12% 12%;        /* #1B1E24 */
--surface-muted: 220 13% 9%;   /* #14161A app bg */
--surface-subtle: 218 13% 16%; /* #232830 */
--border: 217 11% 18%;         /* #262B32 */
--border-strong: 217 10% 26%;
--text: 210 14% 92%;           /* #E8ECEF */
--text-muted: 216 8% 64%;      /* #9AA2AB */
--text-subtle: 216 7% 51%;     /* #7A828C */
--primary: 162 73% 56%;        /* #3FE0B0 mint */
--primary-foreground: 200 30% 6%;
```
Also invert the base `a`/`::selection` rules for dark, and lighten card shadows to subtle borders.

### B. "Ledger" — warm light editorial, oxblood on oat
Light, warm. Font: `Libre Franklin`.
```css
--surface: 40 33% 99%;         /* soft oat paper */
--surface-muted: 40 30% 96%;
--surface-subtle: 40 28% 93%;
--border: 38 20% 86%;
--border-strong: 36 18% 78%;
--text: 20 14% 15%;
--text-muted: 24 10% 38%;
--text-subtle: 28 9% 52%;
--primary: 356 56% 34%;        /* oxblood */
--primary-foreground: 40 33% 99%;
```

---

*Reference mockups (not code to ship — visual target only): `Referrio Theme v3.dc.html` (Workspace/indigo, primary target), `Referrio Theme v2.dc.html` (Command Deck), `Referrio Theme.dc.html` (Ledger).*
