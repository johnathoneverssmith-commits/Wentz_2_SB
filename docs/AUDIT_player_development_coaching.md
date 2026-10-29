# Player development and coaching audit (read-only)

Branch `claude/modest-volta-kkmmx3`, reset to master `b292228`. No tracked file was changed.
Harness scripts and raw output: `/tmp/claude-0/-home-user-Wentz-2-SB/cce18d5c-8914-50c7-bef7-88310eafce44/scratchpad/audit_data/`.

## How this was measured (and the limits)
- **Integrated runs:** 3 CPU-only leagues × 20 seasons (seeds 101/202/303) via `franchise_stress_test.ts`. This harness plays games with the **mock** simulator, not the engine, and the scripted policy passes on free agency. Development, aging, retirement and draft results are valid. Win-based results are not (win% year-to-year autocorrelation was 0.009).
- **Controlled runs:** `runTrainingCamp`, `agingDelta` and `retirementChance` called directly on the real 2026 pool, with identical RNG draws across coach settings. Careers use 2,688 drafted rookies from 12 generated classes, with no injury history. Decade runs have no refill, so the team-strength numbers are indicative.
- **Game runs:** the engine's `simulateGame` with franchise rosters, swapping staffs both ways round to cancel home field. The standard error is about ±0.3 margin points, so effects below that are noise.
- A worker restart killed one planned 12-season run that was to log coach quality per team. Team-level coaching conclusions therefore come from the controlled runs only.

## 1. Architecture: what is implemented vs described
| Factor | Status |
|---|---|
| Age vs per-player `dev_age_threshold` / `decline_age_threshold` | Implemented (`agingDelta`, two rounded steps per year) |
| Hidden potential | Only for drafted rookies (`rules.ts` ~1683). Initial pool and generated depth have none and use a flat league curve |
| Position-specific curves | **Only through the thresholds.** Rookies get `dev = age+4`, `decline = age+10` for every position. Attributes all shift by the same delta, so speed does not decline separately |
| Position-coach scaling (±1.5%/pt) | Implemented, applied after aging |
| Coordinator focus (20% at 72, 5–45%) | Implemented, applied after the position coach |
| Playing time | Only the rookie-policy dial for rookies. No snap or performance input for anyone else |
| Performance / production | Not an input |
| Injuries → rating | **Not implemented.** Injuries only shorten careers through the retirement chance. The code comment about post-ACL decline is not backed by any rating effect |
| Random breakouts / busts | None after age ~26. See section 2 |
| Positional "restoring force" (`agingBalance`) | Hidden: scales development ±50% to pull position starter means back to the league's opening baseline. This stands in for real position-specific aging |
| Rookie vs vet age convention | Camp uses the pre-increment age. Free agents age at rollover with the new age: a one-year offset between rostered and unsigned players |
| Coach progression | **None.** Coaches never age, improve or retire. Only HC/OC/DC enter the carousel; position and medical coaches stay for the life of the league |

## 2. Progression statistics
Year-over-year change in `overall`, rostered players, from the 3×20-season runs (age = age at camp):

| Age | ≤22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean | +1.7 | +1.5 | +1.2 | +0.8 | +0.3 | 0.0 | −0.2 | −0.2 | −0.6 | −1.1 | −1.7 | −2.6 | −2.6 |
| sd | 1.5 | 1.4 | 1.2 | 1.2 | 1.2 | 1.3 | 1.3 | 1.3 | 1.7 | 2.1 | 2.4 | 2.4 | 2.5 |
| % ≥ +4 | 11.6 | 9.1 | 5.4 | 2.9 | 0.8 | 0.3 | 0.2 | 0.1 | 0.2 | 0.1 | 0 | 0.1 | 0.4 |
| % ≤ −4 | 0 | 0 | 0 | 0.2 | 0.5 | 0.9 | 1.4 | 1.9 | 5.5 | 12.4 | 20.2 | 32.4 | 32.8 |

- **Shape:** growth to 25, a flat plateau from 26 to 29 with sd ≈ 1.2, then a cliff from 31. Peak age is 27–28 for almost every position.
- **No breakouts or collapses:** a +4 jump almost never happens after 25. A −6 drop almost never happens before 30 (≤0.2%).
- **Veteran decline is predictable:** the mean follows the age line and the spread is small (a career model with neutral coaches gave p5/p95 of −5/0 at 33).
- **Position differences are thin:** only peak age (RB 26.6, K/P 31, QB 28.7, everyone else 27.5–28.5), retirement age and the "age 30+ mean delta" differ. WR 30+ is −2.4 and OL ~−1.0, but that comes from the threshold draws and the restoring force, not designed curves.
- **Career model (neutral coaches):** time within 3 points of peak is about 7.6–8 seasons for everyone.
- **Retirement hazard** for rostered players, by age band (the 14% at ≤29 is cut-then-pruned washouts, not retirements):

| Position | 31–32 | 33–34 | 35–36 |
|---|---|---|---|
| QB | 9% | 31% | 64% |
| OL | 8–10% | 43–45% | 86% |
| WR / CB / S / ILB | 27–32% | 56–70% | 91–100% |
| RB | 72% | 94% | 100% |
| K / P | 1–3% | 4–5% | 4–7% |

- **Retirement vs rating:** 30+ retirees average ovr 71.9 vs 78.4 for those who stay. About 10% of 30+ retirees are 80+.
- **Draft rounds (classes 2027–2038, ≥8 seasons to develop):**

| Round | Ever a starter | 3+ starter years | Peak ≥ 80 | Gain (peak − first row) |
|---|---|---|---|---|
| 1 | 92% | 79% | 57% | +4.2 |
| 2 | 79% | 59% | 38% | +3.5 |
| 3 | 67% | 45% | 25% | +2.8 |
| 4 | 53% | 30% | 16% | +2.6 |
| 5 | 45% | 25% | 13% | +2.4 |
| 6 | 36% | 18% | 10% | +2.0 |
| 7 | 30% | 15% | 7% | +1.9 |

  Gain sd is only 2.3–2.7 in every round. 14% of rounds 5–7 picks have 5+ starter seasons. Of picks 1–10, 13% have fewer than 3 starter years. These rates are plausible, but the thin free-agent policy in the harness makes starting easier than in a real run.
- **League stability:** players rated 90+ went 65 → ~50 over 20 seasons and mean ovr 73.9 → 71.5 (mild deflation, not runaway). Share of rostered players aged 33+ moved 3–8%.
- **Real-world comparison (judgement, not data):** NFL ratings show larger year-to-year variance, with real breakouts and injury-driven collapses, and peak ages that differ by position (RB earlier, QB later). The flat 4-year plateau and the uniform peak are design choices, not realism.

## 3. Coaching roles
| Role | What it uses | Where it acts | Direct/indirect |
|---|---|---|---|
| HC | gameManagement, discipline, aggression | 4th-down/2-pt logit, penalty rate (±8% over full range) | Direct, in-game |
| OC | playCallIq (→ engine rating), scheme, passBias, tempo | Completion logit, yards per carry, scheme fit on roster `scheme_tags` | Direct. **`tendencyPassRate` is not wired; `tempo` is hard-coded 0** |
| DC | playCallIq, scheme, blitzBias | Completion, rush, sack suppression, blitz | Direct |
| QB / RB / OL / WR / DL / LB / DB | `overall` | Development ×(1 ± 1.5%/pt) and regression ×(1 ∓ 1.5%/pt) for their position group only | Indirect (ratings over time). No game effect |
| ST | `overall` | K/P development only. K/P carry ~0 unit value | Effectively cosmetic |
| MED | `overall` | Injury duration ×0.65–1.35 (1%/pt). Does not affect injury frequency, fatigue or career length | Indirect |
- **Stacking:** position coach and focus multiply, position coach and aging balance multiply, and none of the three can change direction. Overlap with the engine is nil because the nine position coaches never touch a play.
- **Scheme fit:** matters in-game through `scheme_tags`. Drafted rookies and generated depth players get `scheme_tags: []`, so they never fit any scheme, and there is no rule that develops fit.
- **Pay vs value:** HC/OC/DC pay tracks rating (r = 0.86–0.96). Position and medical coach pay is **uncorrelated with rating** (r ≈ −0.3 to +0.3, all $1.1–2.1M) because the pay formula reads `playCallIq` or `gameManagement`, which those coaches don't have, and defaults to 70.
- **Draft/market weights:** `STAFF_WEIGHTS` rate HC 2.5 and coordinators 2.25 against position coaches 0.7–1.2, which is the reverse of measured impact (section 4).

## 4. Controlled coaching experiments
**In-game (engine, paired, ±0.3 margin SE, franchise-reachable range: UI 55–95 maps to engine 44–66):**

| Comparison | Margin (pts/game) | Win% |
|---|---|---|
| Elite vs poor HC | +0.02 | 50.1 |
| Elite vs poor OC | +0.69 | 52.9 |
| Elite vs poor DC | +0.72 | 51.9 |
| Elite vs poor, all three | +0.67 | 52.4 |
| Elite all three vs average (first, smaller sample) | +1.71 | 56.8 |
| Full 90 vs 10 range, all three | +3.54 | 62.3 |

  The staffs the franchise can actually field sit in the small end of this table. The HC is indistinguishable from zero. The all-three effect did not add up across samples (0.67 here vs 1.71 against average), so treat anything below ~1 point as unresolved.

**Development (one camp, real pool, all dev coaches at one level):**

| Group | Coach 40 | Coach 72 | Coach 95 |
|---|---|---|---|
| Developing, mean Δ/yr | +1.05 | +1.63 | +2.16 |
| Prime | −0.24 | −0.02 | +0.18 |
| Declining | **−5.40** | −3.74 | **−2.36** |

- **Careers (same rookies, same draws):**

| Setting | Peak ovr | % reach 85 | % reach 90 | Mean ovr at 33 |
|---|---|---|---|---|
| Coach 40 | 70.9 | 11.9 | 4.2 | 68.6 |
| Coach 72 | 73.2 | 18.2 | 8.3 | 72.9 |
| Coach 95 | 74.9 | 22.7 | 11.8 | 76.1 |
| Coach 95 + focus (coord 95) | 76.6 | 28.1 | 16.3 | 78.3 |

  For scale, a first-round pick peaks about 9 points above a round-3 pick. A coach swing from 40 to 95 is worth about 4 peak points.
- **Per-role team effect** (one role at 95 or 40, others 72; margin points, mean of 2 leagues, year 5): DB +1.16/−1.07, DL +0.87/−1.03, OL +0.74/−1.02, QB +0.66/−0.80, WR +0.60/−0.67, LB +0.38/−0.41, RB +0.38/−0.33, ST ≈ 0. All eight at 95 vs 40: roughly **+4.4 / −4.8 points by year 5**, fading by year 10 as the no-refill cohort turns over.
- **Medical staff:** MED 95 vs 72 shortens a "significant" injury 6 → 5 weeks and a season-ending one 17 → 13; minor and moderate injuries don't change, because of rounding. MED 40 lengthens them by about a third. It has no effect on whether anyone gets hurt.
- **Coaching vs talent:** the eight position coaches together outweigh the HC, OC and DC for any staff the market can produce. League sd of team strength in the same units is about 4–5 points, so a full elite development staff is worth roughly one standard deviation. That is large for a lever that costs the same $1.1–2.1M as a poor one.

## 5. Training camp
Gain in margin points from focusing one group for one camp (32 teams, one league seed, so directional only):

| Focus | Coord 72 | Coord 95 |
|---|---|---|
| QB | 0.15 | 0.27 |
| DL | 0.08 | 0.28 |
| DB | 0.08 | 0.31 |
| OL | 0.07 | 0.26 |
| WR | 0.07 | 0.21 |
| RB | 0.06 | 0.11 |
| LB | 0.03 | 0.12 |

- **Dominance:** RB and LB focus are close to dominated, because those units carry low weight. DB and DL are best for the most teams (16–17 of 32 at coord 95 for DB).
- **Compounding:** over five years with a 95 coordinator, a fixed OL+DB focus gains +1.61 and WR+DB +1.48. The CPU's "weakest-group" rule gains only +0.63, because it chases the thinnest group, not the most valuable. Same-focus-every-year is not penalised at all: there are no diminishing returns, no fatigue and no short-term/long-term choice.
- **Oracle gap:** picking the best focus per team beats the best fixed focus by about +0.1 to +0.2 per camp, so a team's weaknesses do matter, but weakly.
- **Exploit check:** the stack (coach 95 + focus 0.43) cuts veteran decline to roughly a third. Rating stays capped at 99 and direction never flips, so no unbounded ratings, but veteran decline becomes optional for a team that invests.
- **Floor effects:** a base delta of ±1 can never be reduced to 0 by coaching or focus (rounding returns ±1), and a 0 stays 0. A coach can't help prime-age players.

## 6. Findings, ranked
**High**
1. **Position coaches are the strongest, cheapest lever.** They cost the same regardless of rating (r ≈ 0), the effect compounds, and the coaches never age or leave. Whoever drafts the best nine owns a durable edge worth roughly ±4–5 margin points at peak. HC/OC/DC, which the market prices and which `STAFF_WEIGHTS` favour, move games by well under one point.
2. **Coaches never change.** There is no progression, aging, retirement or poaching for the nine development roles and the medical staff; only HC/OC/DC enter the carousel.
3. **Development is nearly deterministic and position-blind.** No breakouts or collapses after the mid-20s, a flat 26–29 plateau, a common peak age, and rookie thresholds that ignore position. The docs say "set per player, by position", which is true only of the original pool.

**Medium**
4. Injuries never touch ratings, despite the code comment about post-ACL decline. Injured players still develop in camp.
5. `agingBalance` is a hidden central planner that stands in for position aging.
6. Training focus is shallow: no trade-off between current and future, no penalty for repeating, RB/LB almost never worth choosing, and the CPU rule underperforms a fixed OL+DB.
7. Drafted and generated players get `scheme_tags: []`, so scheme fit never favours them.
8. `retirementOutcomes` draws one sequential RNG over the whole list, so one player's outcome depends on every player before them; development seeds per player, retirement doesn't. Fine while state and order are identical, fragile for multiplayer parity.
9. Camp-vs-rollover age offset between rostered players and free agents.

**Low**
10. Special-teams coach has no measurable effect; MED effect is rounded away on short injuries.
11. OC `passBias` and `tempo` are cosmetic.
12. Mid-career retirement summaries conflate washouts (pruned free agents, age ~25) with true retirements; any UI or stat reading `retired` needs to separate them.
13. Out of scope but seen: the stress harness logged 8,335 `cap_ledger_mismatch`, 4,702 `missing_owner_team` and 2,445 `signed_player_still_free_agent` invariant failures in one league. These belong to the economy and multiplayer agents.

## 7. Recommended fixes, in order (nothing implemented)
1. Make position-coach pay a function of `overall`, and add the coaches to the carousel (contract expiry, firing, poaching). Reweight `STAFF_WEIGHTS` to the measured impact (DB/DL/OL/QB high, LB/RB lower, ST ~0).
2. Add coach aging or a mild rating drift so the edge isn't permanent.
3. Position-specific `dev_age`/`decline_age` for rookies (RB earlier, QB later) and some variance in prime years, such as a small chance of a breakout or sharp regression. This replaces `agingBalance` over time.
4. Give training focus a cost: diminishing returns per repeated year, or a fatigue/injury trade-off. Make the CPU rule value-weighted by `UNITS` weights.
5. Optionally feed injuries into ratings (a one-time hit after severe injuries), and populate `scheme_tags` for rookies.
6. Make retirement per-player seeded.

**Likely files:** `ui-source/src/state/{trainingCamp,coachEffects,coachingCarousel,coachingDraft,staffRatings,injuries,draftSupply}.ts`, `src/sim/{MockSimulationService,priorities}.ts`, `state/rules.ts`, `state/howItWorks.ts`, and the online mirror in `online/src/phases.ts`.
**Conflict risks:** the economics agent (coach contracts, pay, cap) on items 1–2; the multiplayer agent on the online mirrors; the realism agent if any engine staff coefficient is touched (none is proposed). Items 3–6 change player ratings and so shift balance and the passing-volume statistical baselines.

## 8. Test gaps (avoid exact small-sample averages)
- Rookie thresholds vary by position (item 3). Currently none of the aging tests cover it.
- Retirement independence: removing one player must not change another's outcome.
- Coach monotonicity: a better position coach never lowers a group's expected delta, using seeded paired draws over a large cohort and asserting only the sign.
- Medical effect: asserts recovery weeks never increase with a better staff, and the rounding floor.
- Same seed → identical camp and retirement result, including through `serde.ts` save/reload with `trainingCamp.results`.
- Parity: local `submitTrainingCamp` vs online `decide.ts` produce identical results for the same state and plan.
- Invariants over a multi-season run: ratings in 0–99, no focus ever flips a decline to growth, no retired player develops.
- A guard that position and medical coach pay correlates with rating once fixed.
