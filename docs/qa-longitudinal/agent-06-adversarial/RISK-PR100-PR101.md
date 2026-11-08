# Updated risk assessment — PR #100 and PR #101

Evidence is from `d0727ff` (both merged). Local runs; CI remains the authority.

## PR #100 — playoff bracket/game consistency (TAFI-GAP-011)
**Verdict: fix holds. Residual risk Low.**

What was tried: 8 full seasons on the real engine (two leagues); checker asserts for every bracket winner (participant, stored game exists, game result agrees, no tie, no eliminated team reappears, champion = SB winner, byes handled), plus orphan games with no matchup; reseeding spot-check by hand (2031 L1); UI layer (`/bracket`, `/history`, all 13 `/box/:id` pages show the stored final scores and champion); stability across browser restarts and a reload 100–2500 ms after clicking a round; cross-season `champions` list.
Result: 0 inconsistencies on the engine path, including after restart. The same checker flags the Mock path (13/13 matchups with no stored game), so the checker is not vacuous.

Residual risks:
1. **The guard only holds on the engine path.** On Mock the contradiction/absence still exists (GAP-005, tied to #74). A player who loses the adapter mid-dynasty gets it back with no warning (ADV-related re-verification of GAP-004).
2. **History retains only the viewer's games.** `gameArchive` keeps ~16–22 games per season (viewer's), so another team's past playoff game cannot be re-verified after rollover; only `champions` (champion + runner-up) persists. Not a defect, but any future "past bracket" screen will have nothing to draw.
3. I could not land a reload *inside* a round simulation (it completes in <100 ms), so true mid-simulation interruption is inferred, not observed.
4. Seed/rotation checks covered a 32-team NFL league only; `humansOnly` single-bracket formats were not played.

Suggested guard to keep: run `scripts/check-state.mjs`-style bracket assertions inside `playthrough.test.ts` for N seasons (cheap; catches the next regression at stage boundaries).

## PR #101 — IndexedDB durable saves (TAFI-GAP-008)
**Verdict: does what it claims for crashes, corruption and growth; one design gap (ADV-001). Residual risk Medium-Low.**

Verified in a real browser:
| Claim | Result |
|---|---|
| >5.2 M-char dynasty saves | 6.2 MB (L1 2031), 5.8 MB (L2); never failed across 8 seasons; reload keeps position |
| Atomic double-record | `cur` and `#prev` both present, both 6.2 MB (≈12 MB of IDB per dynasty — fine on desktop, worth knowing for mobile) |
| Damaged newest → `#prev` | loads previous, banner names time, `#damaged` kept |
| Both damaged → loud failure | "couldn't be read… raw data kept"; fresh league shown, raw copy retained |
| Legacy `localStorage` migration | migrated, read-back equal on teams/players, legacy key removed (when seeded before first load) |
| Process restart | resumed at the same stage on every resume (rookie draft, playoffs, hot seat) |
| Hydration gate | no fresh-league flash observed |

Risks / gaps:
1. **ADV-001**: reset overwrites `#prev`. The recovery model is designed for failures, not for the intentional wipe, yet that is the likeliest way a real player loses a long dynasty.
2. **S-1**: legacy string is ignored if IDB already has a record. Low likelihood.
3. **Immediate tab close** and **two-tab last-writer-wins** remain documented limits; not retested here.
4. **Storage doubling**: `#prev` ≈ 2× the dynasty; 10+ seasons were not played (6.2 MB at season 5 and growing ~0.1 MB/season after compaction), so long-horizon growth is extrapolated, not measured.
5. Quota exhaustion in a real browser was not reproduced (unit tests only).

Net: #101 removed the P0 (silent save loss at ~season 2). Keep the soak (`SAVE_SOAK=1`) in the release checklist and fix ADV-001 before wider alpha.
