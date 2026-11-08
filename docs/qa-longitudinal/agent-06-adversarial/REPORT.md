# Agent – Adversarial gameplay & multi-season QA – Report 2026-11-08

## Session header
- Build: `d0727ff` (master), branch `claude/sharp-thompson-p4ky59`; local dev servers: UI `vite` on :5173, engine adapter `tsx server/index.ts` on :8787. Chromium 1243 (system), driven by Playwright (`scripts/lib.mjs`). **Local results — not CI.**
- Mode: single-player (solo). Online mode **not** tested.
- Simulation path (issue #74): **real engine** for every season counted below (adapter reachable; `/simulate-week`, `/playoffs/seed`, `/playoffs/round`, `/plan-preview` calls logged; weather + play-by-play present on all games). One additional season was deliberately played on **mock fallback** (adapter killed) and is labelled as such.
- Pre-baseline: no (RELEASE-READINESS still lists no baseline SHA; this is the Group-08 master).
- League 1: `nfl`, seed 8724, BAL, fantasy draft **off**, defaults otherwise (difficulty/talentImpact left at new-league defaults). Seasons 2027–2031 (5).
- League 2: `nfl`, seed 31337, DAL, fantasy draft **on** (53 manual-top-of-board picks), defaults. Seasons 2027–2029 (3).
- Mock-path continuation: League 2 copy, adapter killed at 2029 hot seat, played 2030.
- Stages completed in the UI: setup → (fantasy draft) → coaching draft → free agency → training camp (+results) → depth chart → preseason ×3 → regular season ×18 → trade deadline → mid-season FA → mid-season depth chart → playoffs (4 rounds) → end-of-season screens → hot seat → retirement → rookie draft (7 rounds, manual pick each round) → rookie draft summary → signings → offseason FA → hooded figure (declined) → next season. Repeated for each season.
- Delegated/auto in the UI (so *not* exercised by hand): coaching draft ("Delegate Remaining Picks"), all five-round FA markets and the trade deadline ("Let my staff take this turn"), contract re-signing ("Let my staff re-sign the core"), depth chart (untouched), game plans (untouched). **No manual trade, contract, or FA bid was made** — see Limitations.
- Browser interactions: ~700 logged scripted clicks across the two leagues plus the attack scripts (driver logs in `evidence/`; the per-run log file is overwritten on each resume, so the league-1 history is split across `segment-d2…d5`).
- Save/reload scenarios exercised: browser process restart + resume at rookie draft, playoffs, hot seat (persistent profile); tampered newest record; tampered newest+`#prev`; legacy `localStorage` migration (seeded before first load); reload ≥100 ms after a playoff-round click; six rapid clicks on Simulate; odd URLs (26); accidental "New solo dynasty".
- Blockers hit: none in-game. Driver issues (stage-detector too tight under CPU contention) were harness bugs, not product bugs; confirmed by resuming.
- Artifacts: `scripts/`, `evidence/`.

## Summary
1. The real-engine solo path held up: 8 consecutive seasons, 6.2 MB saves (over the old 5.2 M-char `localStorage` ceiling), reload-safe, with consistent standings, playoff brackets, box scores, champions and history.
2. #100 (playoff consistency) and #101 (IndexedDB saves) both behaved as designed under every attack tried; residual risk is documented in `RISK-PR100-PR101.md`.
3. New: ADV-001 (New-dynasty wipes the `#prev` recovery copy) and ADV-002 (hundreds of unsigned young free agents are reported as "retiring").
4. #74 is worse in practice than its register entry reads: the dynasty *silently* continued on Mock with impossible scores and no stored playoff games and no banner.
5. Untested: manual trades/contracts/FA bids, online mode, non-default league sizes, other browsers (see Limitations).

## Multi-season playtest (what the numbers were)

| League | Season | Regular season (viewer) | Postseason | Save size at end of season |
|---|---|---|---|---|
| 1 BAL | 2027 | 12–5 (2 seed) | lost WC | 4.3 MB |
| 1 BAL | 2028 | 12–5 (2 seed) | lost WC | 5.7 MB |
| 1 BAL | 2029 | 10–7 (6 seed) | lost DIV | 6.0 MB |
| 1 BAL | 2030 | 5–12 | missed | 6.1 MB |
| 1 BAL | 2031 | 11–6 (6 seed) | lost WC | 6.2 MB |
| 2 DAL | 2027–2029 | see `evidence/ui-run-league2-*.log` | — | 4.6–5.8 MB |

League champions recorded: L1 PHI, SEA, JAX, IND, IND (2031 champion matches the stored bracket); L2 WAS, JAX, GB (2029 matches). Wall-clock: ~5–7 minutes per season of UI automation, dominated by the adapter's simulate calls and the 7-round manual rookie draft.

## Checks run on saved states (all `scripts/check-*`)
- **Invariants** (`check-state.mjs`): unique ids; ratings 0–99; age bounds; every player on a real team/FA/PS/retired; depth charts reference only players on that team, no duplicates; standings fields equal recomputation from stored games; score sanity (no 1-point scores, integers, no extreme totals); every bracket winner is a participant, has a stored game whose result agrees, no eliminated team reappears, champion = SB winner (byes handled); history entries consistent; draft-pick ownership valid, no duplicate non-comp picks. **Engine path: 0 findings in all 5 states checked. Mock path: 16 (3 impossible scores, 13/13 playoff matchups with no stored game).**
- **Standings recomputation** (`check-standings.ts`): the engine's own `computeStandings` vs stored seeds, division ranks, records, history seed — 0 mismatches (2031 L1, 2029 L2). Note the engine uses `LA` where the UI uses `LAR`; the adapter maps it, the check maps it too.
- **Box scores** (`check-boxscores.mjs`): 411 engine games — points = score, quarters sum to score, pass+rush = total yards, completions ≤ attempts, turnovers = INT+fumbles lost, last scoring play = final score: all clean. Player lines vs team totals do **not** reconcile (known: TAFI-GAP-003; re-measured below).
- **Cap** (`check-cap.mjs`): `cap.used == Σ cap hit(0) + dead` for all 32 teams in 4 states; no team over the cap, no negatives.
- **Year-over-year** (`check-transition.mjs`, L2 2027→2028 preseason): age +1 for every non-retired player (0 exceptions); no player removed from state; no |Δovr| ≥ 15; mean Δovr ≤24: +1.24, 25–28: +0.04, 29–31: −0.98, 32+: −1.72; every roster exactly 53; no duplicate active names.

## Findings
See `TAFI-INVENTORY.md` for the full records. Short list:

| ID | Title | Sev | Status |
|---|---|---|---|
| ADV-001 | "New solo dynasty" overwrites live save *and* `#prev` in <300 ms | P2 | Confirmed, 2/2 |
| ADV-002 | 42% of "retirements" are unsigned free agents aged ≤24 | P3 | Confirmed (data); UI exposure unverified |
| — | GAP-001/003/004/005/006/007 re-verified (see inventory) | — | Existing |

## Positive observations (protect against regressions)
- Corrupt newest record → loads `#prev`, tells the player, keeps `…#damaged`. Corrupt both → loud banner, raw record kept, no silent overwrite.
- Legacy single-string `localStorage` save migrated to IndexedDB, removed from `localStorage`, and state byte-equal on teams/players.
- Six rapid clicks on "Simulate Preseason" → exactly 16 games, 16 unique ids (no double-simulation).
- Reload 100/600/2500 ms after "Simulate the Wild Card": 6 games and 6 decided matchups every time (round sim is atomic from the store's view).
- 26 odd URLs: no crash, no stage/week/season mutation.
- Playoff reseeding (1-seed vs lowest remaining) correct in the 2031 L1 bracket.
- Cross-season champions list and per-season history stay accurate through 5 rollovers.

## Limitations (also in the coverage matrix)
- **Not tested:** manual trades (exploit hunting), manual FA bids/contract negotiation, restructure/extension abuse, game-plan editing, online/multi-GM mode, `humansOnly` or non-32-team leagues, hooded-figure *payment* branch, Firefox/WebKit, two tabs on one dynasty, a tab closed inside the write window, quota-exhaustion in a real browser. Only one human team per league and default difficulty/talentImpact.
- The UI was driven by a heuristic script (priority-ordered button clicks), so UX friction a person would feel is not measured; the script *did* use real controls and the real adapter.
- A reload within <100 ms of a round click could not land inside the simulate call (it finishes faster than that), so "interrupted mid-simulation" was not reproducible; atomicity is inferred from before/after states only.
- Engine-level statistics (realism of league-wide stat lines) were not part of this brief.
