# PD-2: player aging and development

Branch `pd2-aging-development`, from master `2155139` (includes PD-1, merged as `943fa04`).
All figures are from the real franchise loop (`ui-source/scripts/franchise_stress_test.ts`: stage machine, coaching draft, camps, rollover, retirements, rookie drafts), **3 leagues × 15 seasons** (seeds 101/202/303), CPU-only, before and after. That harness plays games with the mock simulator and its free-agency policy is passive, so ratings, ages, retirements and rosters are valid and game results are not.

## Phase 1 — PD-1 deployment
The master push run for PD-1 (`943fa04`, run 40790891298) passed `test`, then `deploy` including "Deploy this exact commit to both Render services" and "Verify both services are serving this commit". Both succeeded. A direct request to the live site from this sandbox is blocked by the egress proxy, so the live commit check is the workflow's own step, not mine. Master has since moved (PBP-2, MP-3), so the live site is no longer at `943fa04`.

## Baseline problems (pre-PD-2, 3 leagues × 15 seasons)
- **Position-blind curves.** Peak age was 26–28 for every position; a drafted rookie's decline age was `age + 10` whatever his position. Skill-position and lineman declines looked alike.
- **Very predictable prime.** Ages 26–30: year-to-year sd 1.40, only 0.4% of seasons gained 4 or more, 1.5% lost 4 or more.
- **Everyone the same person.** No early or late bloomers, no plateaus, no streaky players.
- **Talent drifts down.** Rated 90+ players fell from ~64 to ~45 over 15 seasons; starters at CB −5, EDGE −4, WR −3 points.

## What changed (aging model only)
`sim/careerShape.ts` (new, not stored): `careerShape(player)` is computed from the position and the player id, so existing saves need no migration and no new seed is generated at load; it is the same in any order and after any reload.
- **Position:** `POSITION_CAREER` moves a position's development age (RB −2, CB/ILB/WR −1, QB and K/P +2, linemen +1) and its decline slope (RB 1.25 … QB 0.8, linemen 0.85, K/P 0.5). A shorter or longer developing window scales growth so a position reaches about the same level at a different age, not a lower one. These are design choices, not NFL measurements.
- **Person:** early / normal / late / very late bloomers (20/55/20/5%), plateaus and climbers (growth ×0.7 / 1 / 1.3, 15/70/15%), steady and streaky players (variance ×0.8 / 1 / 1.4, 30/40/30%).
- **Breakouts and slumps:** once a year, only between one year before development ends and the decline age: +up to 3 (capped by remaining room when a ceiling is known) or −2, at 5% × volatility each.
- **New rookies** get the shipped pool's rule for decline age (a position's outer age less 0–4 years, never before `age + 7`), instead of `age + 10`.
- Callers pass the shape: camp (`trainingCamp.ts`) and the rollover path (`seed.ts`). `agingDelta` without a shape is **bit-identical** to before, which keeps `expectedAgingDelta` and `contractValue` valid.
- Coaching (PD-1) and retirement (`retirementChance`, per-player draws) are untouched; coaches scale whatever the model decides, including breakouts and slumps.

## Measured: 15 seasons, real franchise engine
| | Before | After |
|---|---|---|
| Peak age, players first seen ≤24 | C 27.5 CB 26.9 QB 28.1 RB 26.2 WR 27.2 OT 27.9 K 29.4 | C 28.2 CB 27.2 QB 29.1 RB 26.0 WR 27.5 OT 29.2 K 31.0 |
| Prime (26–30) year-to-year sd | 1.40 | 1.72 |
| Prime seasons ≥ +4 / ≤ −4 | 0.4% / 1.5% | 1.5% / 3.7% |
| Mean delta ages 31–32, CB / WR / EDGE | −2.3 / −2.7 / −2.1 | −3.1 / −2.7 / −2.2 |
| Mean delta ages 31–32, QB / OT / C | −0.4 / −0.5 / −0.5 | −0.4 / −0.6 / −0.5 |
| Mean delta ages 29–30, RB | −1.0 | −2.1 |
| Mean rating, all players, year 15 | 71.2 | 71.2 |
| Players rated 90+, year 1 → year 15 | 63.7 → 45.0 | 65.3 → 55.0 |
| Starter mean, year 15: QB / CB / EDGE / RB / WR | 81.1 / 72.3 / 76.8 / 80.8 / 75.6 | 83.0 / 73.1 / 77.5 / 78.8 / 76.0 |
| Share of rostered players 33+, year 15 | 6.9% | 6.8% |
Career-level check (2,688 drafted rookies, neutral coaches, no injuries): rating-points above 70 over a career 59.8 → 58.7, mean peak 73.2 → 73.3, K/P careers run longer (to ~42) because their decline now comes late.

## Tests
`ui-source/src/sim/careerShape.test.ts` (10): shape is a function of id and position, survives JSON reload and reversed storage order, spreads of bloomers / plateaus / volatility; RB and CB peak earlier than QB and OT; RB falls faster than QB and K barely falls; new rookies get position-based decline ages; prime variance is wider but breakouts and slumps are rare and the mean unchanged; seeded determinism; unshaped path unchanged; retirement eligibility compatible; **long-term stability** (shaped vs unshaped model: total career rating within ±10%, peak level within 1 point, star share within ±15%). PD-1's coaching, camp-RNG and retirement tests all still pass. Negative controls: with no shape the old curve returns exactly; the stability test is the guard against the position shifts creating or destroying talent (it failed, at −14%, with an earlier decline age and that is how the rookie rule was tuned).

## Compatibility and risks
- Existing saves keep every stored threshold and rating. Their players are aged by the new curve from the next camp; rookies drafted before the change keep `age + 10`.
- `contractValue` and the CPU contract logic project aging with the unshaped curve (their call is unchanged, per scope). The mean is close but not equal for the positions with a different slope (RB, K/P): passing `careerShape` into `projectRatings` is a one-line follow-up in CPU-contract code that I did not touch.
- The positional "restoring force" (`agingBalance`) is unchanged and still masks part of any residual drift.
- K/P careers end ~6 years later than before; roster slots for them are two per team.
- Fictional-player generation is not touched.
