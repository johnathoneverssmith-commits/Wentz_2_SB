# Gameplay coverage matrix

Grounding: **UI** = played through real controls in Chromium against the real adapter; **UI+script** = real UI driven by an attack script; **state** = analysis of saved state produced by UI play; **not tested**.
Result: ✔ no defect found · ⚠ finding · ✖ not covered.

| Area | How exercised | Grounding | Result |
|---|---|---|---|
| League creation + seed + team pick | Setup tabs, seed field, "Create league with this universe", lobby team pick, ready | UI | ✔ |
| Fantasy draft (on) | 53 manual top-of-board picks, summary dialog | UI | ✔ (L2) |
| Standard roster setup (draft off) | straight to coaching draft | UI | ✔ (L1) |
| Coaching draft | "Delegate Remaining Picks" (confirm modal) | UI (delegated) | ✔ |
| Free agency (5 rounds, ×2 per year) | "Let my staff take this turn" → confirm plan | UI (delegated) | ✔ no manual bids ✖ |
| Training camp | focus pick (QB / DL), results | UI | ✔ |
| Depth chart | left as-is; "Ready" | UI | ✖ manual reorder not tested |
| Preseason ×3, regular season ×18 | Simulate buttons | UI, real engine | ✔ |
| Game planning | not edited (hub panel read only) | — | ✖ |
| Trade deadline (3 rounds) | delegated to staff | UI (delegated) | ✖ manual trades not tested |
| Mid-season FA + depth chart | delegated | UI | ✔ |
| Playoffs (WC→SB) | round-by-round Simulate | UI, real engine | ✔ |
| End-of-season, hot seat, retirement | click-through | UI | ✔ / ⚠ ADV-002 |
| Rookie draft (7 rounds) | manual first-row pick each round | UI | ✔ |
| Rookie signings, offseason FA | delegated | UI | ✔ |
| Hooded Figure | encountered at least once; "Decline" only | UI | ✔ payment branch ✖ |
| Player development / aging | year-over-year diff L2 2027→2028 | state | ✔ |
| Retirement | same diff; 332 flagged | state | ⚠ ADV-002 |
| 5 consecutive seasons | L1 2027–2031 | UI | ✔ |
| Standings & tiebreakers | engine `computeStandings` vs stored (2 states) | state | ✔ (ties exercised only incidentally) |
| Schedule consistency | every team has equal games played at season end; 272 REG games; byes | state | ✔ |
| Salary cap / contracts | `used == Σcap + dead`, none over cap, no negative | state | ✔; extensions/restructures ✖ |
| Draft-pick ownership | owner ∈ teams, no duplicate non-comp picks, 2 future years held | state | ✔; traded-pick flows ✖ |
| Duplicate / missing players | ids unique; none removed between years; names unique among active | state | ✔ |
| Impossible scores / stats | 411 engine games box-score checks | state | ✔ (engine); ⚠ Mock (GAP-001) |
| Player lines vs totals | 36 REG/POST games with lines | state | ⚠ GAP-003 re-measured |
| Playoff consistency (#100) | bracket ↔ games ↔ champion ↔ history ↔ UI pages, 8 seasons, + interruption | state + UI+script | ✔ |
| Save: reload at stages | browser-process restart at rookie draft, playoffs, hot seat | UI | ✔ |
| Save: large multi-season | 6.2 MB records, ×2 with `#prev` | UI | ✔ |
| Save: corrupted newest / both | byte-flip in IndexedDB | UI+script | ✔ |
| Save: legacy migration | `localStorage` string seeded before first load | UI+script | ✔ |
| Save: interrupted write | reload 100–2500 ms after click; unload mid-IDB-write not reproducible | UI+script | ✔ / ✖ true mid-write |
| Save: quota exhaustion in a browser | — (unit-covered by #101) | not tested | ✖ |
| New dynasty / reset | accept native confirm | UI+script | ⚠ ADV-001 |
| Rapid clicks | 6× Simulate Preseason | UI+script | ✔ |
| Odd URLs | 26 routes out of stage | UI+script | ✔ no crash/mutation; GAP-007 |
| Adapter loss mid-dynasty (#74) | kill adapter, play 2030 | UI | ⚠ GAP-004/001/005 re-verified |
| Solo ↔ online switching | — | not tested | ✖ |
| Online / multi-GM | — | not tested | ✖ |
| Unusual league sizes / `humansOnly` | — | not tested | ✖ |
| Two tabs, same dynasty | — (known limit in docs/save_persistence.md) | not tested | ✖ |
| Browsers other than Chromium | — | not tested | ✖ |
