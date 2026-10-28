# UI-1 / UI-2: franchise presentation

Approved brief: a premium dark sports-management design and consistent, non-blocking motion, using the supplied reference as direction rather than copying its branded assets.

## Implementation decisions
- Retain React, the existing Framer Motion dependency, the motion preference control, team colors and native game controls.
- Layer ink/teal surfaces with blue, violet and gold functional accents. Use existing typefaces with a deliberate size/spacing scale; no new font or asset service.
- Shared CSS tokens and reusable passive surface/meter primitives form UI-1. Existing screens inherit the foundation; their individual redesigns remain UI-3 through UI-5.
- UI-2 adds a real-data command-center overview to Weekly Team Hub: public schedule + revealed results, unit ratings, cap position and links to existing front-office routes. No invented assistant, chemistry, search, or financial advice.
- Move the existing Game Day controls ahead of the detailed tabs without changing their handlers or eligibility.
- Keep route transitions non-blocking: do not retain an old gameplay screen during an exit animation, because its effects/actions must not outlive navigation. Passive surfaces expose exit motion for later modal/drawer adoption.
- Reduced motion overrides saved motion preferences, including changes while the app is open. No large-list stagger, indefinite loops, or React state updates per animation frame.

## Plan and acceptance
1. Add tokens and passive motion primitives; test preference precedence and meter semantics.
2. Compose the hub presentation around existing values and controls; preserve all tabs, data and online reveal filtering.
3. Validate desktop/mobile, keyboard navigation, current values, reduced motion, and real Game Day navigation in browser tests.
4. Run typechecks/UI tests and franchise browser regressions. Capture desktop/mobile and a brief motion clip from an isolated seeded test game.
5. Open a dedicated PR with exact head/CI evidence. Do not merge or deploy.

No changes to state, calculations, saves, APIs, multiplayer rules, or arcade.

## Review artifacts
These use the deterministic solo test league, not invented prototype stats.
- [Desktop screenshot](desktop.png)
- [Mobile screenshot](mobile.png) and [full mobile page](mobile-full.png)
- [Short motion demonstration](dashboard-motion.webm)

The clip shows the actual local application: entrances, hover feedback and tab changes.
External requests are blocked by the browser-test guard. No deployed service or production save is used.

## Motion and performance boundaries
Framer Motion is already installed; no dependency or lockfile changes are needed.
Only four dashboard surfaces stagger, with capped delays. Meters animate transforms, and number
animation writes to its own span rather than scheduling React state updates each frame.
The timeline is a native horizontal list, not a table/list animation campaign. Nothing waits
for an animation before accepting a gameplay action.

A device's reduced-motion preference always wins, responds while the page is open, and leaves
the user's saved preference intact. Explicit choices still work if browser storage is blocked.
Keyboard tabs move focus with selection, and the skip control targets the main landmark.
Full modal/drawer and remaining-screen redesign adoption belongs to UI-3 through UI-5.
