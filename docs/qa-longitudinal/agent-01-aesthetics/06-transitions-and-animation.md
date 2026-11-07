# 06 · Transition & animation proposal

**Status: proposal from stills and code, not a review of motion.** I could not judge timing/feel (see README). I confirmed: the app has a Motion setting (Full/Subtle/Off), `framer-motion` is a dependency, and with reduced motion on no animations were running on the hub. Everything below must honour that setting and `prefers-reduced-motion` (swap movement for a 150ms fade or an instant state change).

Principles: ≤ 600ms for a moment, ≤ 200ms for a transition; never block input; skippable by click/Esc; one hero moment per event, not per row.

| Moment | Today (from stills) | Proposal | Time |
|---|---|---|---|
| Draft selection | Row action → list changes; on-the-clock overlay (clipped, TAFI-003) | Selected row lifts into a "pick card" (name, position, OVR, school) that docks into "Your players" with a count tick-up; overlay fixed per 003 | 500 ms |
| Coaching hire | Button → row | Photo/initials chip flies to the staff slot; slot border flashes team colour | 400 ms |
| FA signing | Notice text | Contract "stamp" (years / $) on the player row, cap bar animates the new used amount | 450 ms |
| Trade accepted | Summary screen | Two-card swap with the cap-line bar sliding; "Trade complete" header | 600 ms |
| Training camp done | Navigates to results | Focus groups tick up (+x ovr) in sequence, largest gain first | ≤ 1 s, skippable |
| Week advance | Page change | Season Timeline pill slides to the next week; record counter ticks | 300 ms |
| Playoff qualification | Text in hub/bracket | Seed badge drops into the bracket with a team-colour sweep | 600 ms |
| Super Bowl win | Awards list / subtitle (TAFI-010) | Full-width champion banner, confetti in team colours (Full only; Subtle = static glow) | 2 s, skippable |
| Major retirement / special event | Text card | Slow desaturating portrait + career line; no sound change (audio agent) | 800 ms |
| Page-to-page | Hard cut | 150 ms cross-fade of the body, masthead persists | 150 ms |

Implementation notes: gate every animation on one `useMotion()` hook (reads the Motion setting and the media query); animate only transform/opacity; test with reduced motion and with the Motion toggle at Off; never delay the game state commit — animate after it.
