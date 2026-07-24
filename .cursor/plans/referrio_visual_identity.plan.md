# Referrio visual identity

## Subject

Referrio is a referral handoff workspace for AFC mortgage consultants, AHA agents, and operations staff. Its primary job is to make ownership, movement, and the next handoff unmistakable.

## Design system

- **Midnight route** `#132238`: navigation, high-emphasis controls, and trust.
- **Relay blue** `#2457D6`: active states and links that move work forward.
- **Signal coral** `#E4684A`: the single warm accent for handoffs and urgent attention.
- **Ledger paper** `#F4F7F9`: the quiet operational workspace.
- **Route mist** `#E8EEF3`: boundaries, tracks, and inactive connections.
- **Ink** `#142033`: primary text.
- **Typography:** Archivo for display and navigation, IBM Plex Sans for working copy, IBM Plex Mono for route labels and operational metadata.

## Layout

The application should feel like a calm routing desk rather than a stack of generic SaaS cards.

```text
┌──────── route rail ────────┬──────────────── workspace ────────────────┐
│ Referrio •──• Handoff desk │ PAGE LABEL                     action     │
│                            │ Characterful title                        │
│ Work                       ├────────────────────────────────────────────┤
│ ● Dashboard                │ quiet operational surfaces                │
│ │ Referrals                │ with thin route-edge details              │
│ ○ Deals                    │                                            │
└────────────────────────────┴────────────────────────────────────────────┘
```

## Signature

A paired-node handoff mark and route rail represent one trusted person passing a client to the next. It appears in the brand mark, active navigation, authentication story, and selective surface accents.

## Restraint

The connected route is the only expressive motif. Avoid decorative gradients, excessive pills, and ornamental motion. Motion remains functional and is disabled when reduced motion is requested.

## Implementation

1. Replace the neutral slate/Inter foundation with the token and type system.
2. Add a reusable accessible brand mark.
3. Apply the handoff rail to desktop/mobile navigation and authentication.
4. Refine shared cards, headers, controls, and referral hero so existing pages inherit the identity.
5. Verify type safety, responsive behavior, keyboard focus, and reduced motion.
