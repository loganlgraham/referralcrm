---
name: Referrio
description: Light, professional operations UI for referral and lending workflows—cool slate neutrals with a deep charcoal brand anchor and restrained semantic color.
colors:
  background: "#F1F5F9"
  background-subtle: "#F8FAFC"
  surface: "#FFFFFF"
  surface-raised: "#FFFFFF"
  foreground: "#0F1729"
  foreground-muted: "#4F5C6D"
  foreground-subtle: "#6E7D91"
  primary: "#1F2937"
  primary-foreground: "#FFFFFF"
  primary-hover: "#111827"
  primary-active: "#111827"
  primary-muted-surface: "#F9FAFB"
  primary-muted-border: "#E5E7EB"
  primary-accent-text: "#111827"
  border: "#E2E8F0"
  border-strong: "#CBD5E1"
  ring: "#374B6D"
  success: "#278B5D"
  success-foreground: "#FFFFFF"
  success-soft: "#E7F9F0"
  success-on-soft: "#186B47"
  success-emphasis: "#206B47"
  warning: "#DB7706"
  warning-foreground: "#1A0D00"
  warning-soft: "#FEF7E1"
  danger: "#D32222"
  danger-foreground: "#FFFFFF"
  danger-soft: "#FDEDED"
  info: "#0C6CE9"
  info-foreground: "#FFFFFF"
  info-soft: "#E6F1FE"
  info-on-soft: "#0A5BC4"
  progress-soft: "#F2F0FF"
  progress-foreground: "#4934B2"
  progress-outline: "#D2CBF6"
  auth-hero-gradient-start: "#111827"
  auth-hero-gradient-mid: "#1F2937"
  auth-hero-gradient-end: "#0B1220"
  auth-hero-highlight: "#5C6674"
  auth-hero-shade: "#171E29"
  link-contrast: "#111827"
  inverse-text: "#FFFFFF"
  inverse-text-dim: "#DEE0E4"
  inverse-text-muted: "#D2D4D7"
  selection-surface: "#C7C9CD"
  surface-toolbar-tint: "#F8FAFC"
typography:
  display-hero:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: "600"
    lineHeight: 52px
    letterSpacing: "-0.02em"
  display-hero-xl:
    fontFamily: Inter
    fontSize: 60px
    fontWeight: "600"
    lineHeight: 60px
    letterSpacing: "-0.02em"
  headline-page:
    fontFamily: Inter
    fontSize: 30px
    fontWeight: "600"
    lineHeight: 36px
    letterSpacing: "-0.02em"
  headline-page-sm:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: "600"
    lineHeight: 32px
    letterSpacing: "-0.02em"
  title-section:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: "600"
    lineHeight: 26px
    letterSpacing: "-0.01em"
  title-card:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "600"
    lineHeight: 24px
    letterSpacing: "-0.01em"
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: "400"
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "400"
    lineHeight: 20px
  label:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "500"
    lineHeight: 20px
  label-strong:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: "600"
    lineHeight: 20px
  caption:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: "400"
    lineHeight: 16px
  meta:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: "400"
    lineHeight: 16px
  overline-section:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: "600"
    lineHeight: 16px
    letterSpacing: 0.14em
  eyebrow:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: "600"
    lineHeight: 16px
    letterSpacing: 0.18em
rounded:
  sm: 6px
  md: 8px
  card: 14px
  pill: 9999px
spacing:
  unit: 4px
  unit-lg: 8px
  stack-tight: 8px
  stack: 16px
  stack-section: 24px
  inset-page-x-mobile: 16px
  inset-page-x-desktop: 32px
  inset-page-y-mobile: 24px
  inset-page-y-desktop: 32px
  content-max-width: 1280px
  card-padding-x: 20px
  card-padding-y: 16px
  card-header-padding-x: 20px
  card-header-padding-y: 16px
  card-footer-padding-x: 20px
  card-footer-padding-y: 12px
  auth-panel-padding: 24px
  auth-panel-padding-desktop: 32px
  auth-panel-max-width: 448px
  auth-panel-wide-max-width: 576px
  sidebar-width: 256px
  shell-inset: 12px
elevation:
  card-shadow: "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px -12px rgba(15, 23, 42, 0.12)"
  raised-shadow: "0 4px 12px rgba(15, 23, 42, 0.06), 0 20px 40px -16px rgba(15, 23, 42, 0.18)"
  focus-ring-glow: "0 0 0 4px rgba(55, 75, 109, 0.25)"
  control-shadow: "0 1px 2px rgba(15, 23, 42, 0.06)"
  brand-glow-subtle: "0 0 10px rgba(31, 41, 55, 0.6)"
motion:
  duration-instant: 150ms
  duration-short: 200ms
  duration-route-progress: 900ms
  duration-route-complete: 350ms
  easing-standard: ease-out
  easing-emphasis: ease-in-out
  easing-finish: ease-out
  animation-fade-in: "fade-in 150ms ease-out"
  animation-slide-in-right: "slide-in-right 200ms ease-out"
  animation-slide-out-right: "slide-out-right 200ms ease-in"
components:
  app-body:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
  link-default:
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
  link-accent:
    textColor: "{colors.link-contrast}"
    typography: "{typography.label-strong}"
  sidebar-shell:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.foreground}"
  sidebar-brand-mark:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    typography: "{typography.label-strong}"
  sidebar-nav-active:
    backgroundColor: "{colors.primary-muted-surface}"
    textColor: "{colors.primary-accent-text}"
  sidebar-nav-inactive:
    backgroundColor: transparent
    textColor: "{colors.foreground-muted}"
  sidebar-nav-indicator:
    backgroundColor: "{colors.primary}"
    rounded: 2px
  card-standard:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
  card-toolbar:
    backgroundColor: "{colors.surface-toolbar-tint}"
    textColor: "{colors.foreground}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
  input-field-focus:
    backgroundColor: "{colors.surface}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    height: 36px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.danger-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  button-lg:
    height: 44px
  badge-neutral:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.pill}"
  badge-success:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success-on-soft}"
    rounded: "{rounded.pill}"
  badge-progress:
    backgroundColor: "{colors.progress-soft}"
    textColor: "{colors.progress-foreground}"
    rounded: "{rounded.pill}"
  toast-surface:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
  auth-hero-panel:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.inverse-text}"
  auth-form-panel:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
  auth-hero-background-top:
    backgroundColor: "{colors.auth-hero-gradient-start}"
  auth-hero-background-mid:
    backgroundColor: "{colors.auth-hero-gradient-mid}"
  auth-hero-background-bottom:
    backgroundColor: "{colors.auth-hero-gradient-end}"
  auth-hero-veil-light:
    backgroundColor: "{colors.auth-hero-highlight}"
  auth-hero-veil-dark:
    backgroundColor: "{colors.auth-hero-shade}"
  chrome-caption:
    backgroundColor: "{colors.background-subtle}"
    textColor: "{colors.foreground-muted}"
  text-selection-preview:
    backgroundColor: "{colors.selection-surface}"
    textColor: "{colors.foreground}"
  alert-warning-panel:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-foreground}"
  alert-info-panel:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info-on-soft}"
  toast-info-accent:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.info}"
  danger-alert-soft:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
  border-hairline:
    backgroundColor: "{colors.border}"
    height: 1px
  border-emphasis:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  focus-ring-color:
    backgroundColor: "{colors.ring}"
    height: 2px
  success-solid:
    backgroundColor: "{colors.success-emphasis}"
    textColor: "{colors.success-foreground}"
  progress-outline-swatch:
    backgroundColor: "{colors.progress-outline}"
    height: 1px
  badge-primary-accent:
    backgroundColor: "{colors.primary-muted-surface}"
    textColor: "{colors.primary-accent-text}"
    rounded: "{rounded.pill}"
  primary-muted-divider:
    backgroundColor: "{colors.primary-muted-border}"
    height: 1px
  hero-body-text:
    textColor: "{colors.inverse-text-dim}"
    typography: "{typography.body-sm}"
  hero-muted-text:
    textColor: "{colors.inverse-text-muted}"
    typography: "{typography.meta}"
  warning-solid-badge:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.warning-foreground}"
    rounded: "{rounded.pill}"
  info-solid-badge:
    backgroundColor: "{colors.info}"
    textColor: "{colors.info-foreground}"
    rounded: "{rounded.pill}"
  supporting-text-muted:
    textColor: "{colors.foreground-subtle}"
    typography: "{typography.caption}"
  semantic-success-indicator:
    backgroundColor: "{colors.success}"
    height: 8px
    width: 8px
---

## Overview

Referrio presents a **bright, trustworthy operations desk**: plenty of breathing room, cool gray staging areas, and confident charcoal anchors for navigation and primary actions. The personality is **calmly efficient**—documents and relationship data first, decoration second. Marketing and sign-in moments lean on a **deep slate hero gradient** with soft light falloff so the product feels established and serious without resorting to heavy skeuomorphism or trendy glass effects.

The experience is **light mode first**: crisp white surfaces on a misty blue-gray page background, with shadows so subtle they read as lift rather than drama. Motion is **barely-there**: quick fades and slides for overlays, with a slim brand-tinted progress shimmer at the top during route changes so the app feels responsive without distracting the user.

## Colors

The palette is a **cool neutral foundation** (mist background, white cards, blue-gray borders) paired with a **single deep brand anchor** in charcoal slate for the logo mark, primary buttons, active navigation, and progress indicators. Text uses a near-navy foreground for maximum readability, stepped down to muted slate for secondary labels and metadata.

Semantic accents are **disciplined and operational**: forest green for success, amber-orange for caution, true red for errors, and a clear blue for informational states. Each semantic color has a **soft tint surface** for inline alerts, badges, and validation panels so messaging feels supportive rather than loud. A distinct **violet progress family** separates in-flight states from terminal success—use it when something is underway but not yet closed.

**Auth and storytelling surfaces** layer two radial washes over a corner-to-corner charcoal gradient: a bright, diffuse highlight from the top and a gentle vignette from the bottom-left. Hero copy stays white with slightly transparent body text so hierarchy stays clear against the rich background.

## Typography

**Inter** drives the entire interface for its neutral, business-correct tone. Enable subtle stylistic alternates on long-form UI for a slightly refined rhythm. Hierarchy leans on **weight and tracking**, not decorative display faces: section titles are semibold and tight-tracking, while metadata and navigation labels shrink to compact sizes with increased letter spacing for "overline" labeling.

Eyebrows and marketing labels use **wide tracking and uppercase treatment** to scan quickly without shouting. Card titles stay at a modest size—this is a data product, so headlines rarely exceed what is needed to orient the user on a dense page. Hero marketing headlines may jump to a larger display size on wide screens, but dashboard interiors stay restrained.

## Layout

Content sits in a **centered reading column** on wide screens with a fixed-width side navigation rail. Vertical rhythm favors **24-pixel section gaps** on dashboard pages, with tighter 8–16 pixel spacing inside toolbars and filter rows. Cards and auth panels use **generous horizontal padding** so forms and tables never feel edge-to-edge.

The shell reserves a **persistent sidebar** on large breakpoints while collapsing navigation for small screens—surface continuity is maintained so the user always perceives the same neutral staging color behind work areas. Auth flows use a **split layout**: a fixed marketing column and a centered form panel, switching to a single column on small viewports.

## Elevation & Depth

Depth is **photographic and restrained**. Primary containers use a **two-layer shadow**: a hairline close shadow for edge definition and a broad, soft penumbra that lifts panels just above the page. Modals, menus, auth panels, and toasts step up to a **deeper raised shadow** so they clearly float above scrolling lists.

Focus states use a **high-visibility ring**: a 2px ring in the brand blue-gray family plus a 2px offset from the control, with an optional outer 4px glow for extra clarity on dense tables. Primary controls may carry a **light drop shadow** to separate them from flat surfaces. A slim **route progress** element at the top of the viewport uses a luminous gradient stroke with a gentle glow—enough to reassure, not enough to compete with page content.

## Shapes

Corner radii are **modern but office-appropriate**. Interactive controls and navigation rows use a compact radius; cards, panels, and notifications use a **somewhat softer, larger default radius** so data groupings read as cohesive tiles. Fully rounded **pill shapes** are reserved for compact status chips and tags.

## Components

**Navigation** pairs an active **soft tinted fill** with a **vertical bar indicator** at the leading edge—this makes the current section obvious even when skim reading. Icons sit at a small fixed square size and inherit muted colors until hovered or selected.

**Cards** are bordered, softly shadowed, and often divided by top and bottom rules. Toolbars nested in cards may use a **half-strength tinted band** to separate filters from results without introducing a second card.

**Form controls** fill the width of their container, use compact height on standard fields, and show **focus rings in brand-tinted blue** rather than harsh browser defaults. Invalid fields layer danger soft fills and borders without rewriting the entire control style.

**Buttons** span a few hierarchy levels: filled primary for irreversible or main submission paths, bordered secondary for alternative actions, quiet ghost and subtle fills for low-friction utilities, and a dedicated danger treatment for destructive work. Sizes step from compact inline actions to a larger full-width auth submit.

**Badges** are capsule chips with hairline rings, leaning on semantic soft fills. Keep labels short; when space is tight, a leading dot can punctuate state without extra copy.

**Auth patterns** contrast a rich gradient story panel with a clean, bright form card. Supporting links in forms pick up the **deep accent text color** rather than default browser blue, keeping the palette self-consistent.

## Do's and Don'ts

- Do keep **backgrounds cool and surfaces white** for the main application; rely on spacing and light shadows—not heavy borders everywhere—to separate regions.
- Do use **semantic soft fills** behind alerts and badges so state reads instantly in peripheral vision.
- Do preserve **strong contrast** on primary buttons and hero inverse text; the brand anchor is dark on purpose.
- Don't introduce **dark chrome** in core workflows unless explicitly switching the whole experience; partial dark panels beside light content will feel accidental.
- Don't use **neon or rainbow accents** for routine CRM tasks; let semantic colors carry meaning.
- Don't animate large layout shifts; prefer **opacity and short lateral moves** under 200ms for overlays and drawers.
