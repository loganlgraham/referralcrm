# Smooth search across referrals, deals, agents, and MCs

1. Trace search state, routing, and loading behavior on all four pages and identify sources of input lag and layout flicker.
2. Introduce one isolated search input with a consistent short debounce, safe URL synchronization, first-page reset, and preserved scroll position. Keep server navigation for referrals; update client-driven list searches without a server-page round trip.
3. Integrate the shared input across all four pages, retain existing results during client fetches, and show a small updating indicator without disabling search.
4. Verify rapid typing, delayed responses, clearing, URL navigation, filter preservation, and pagination reset with focused regression tests; run the TypeScript check and review the React changes.
