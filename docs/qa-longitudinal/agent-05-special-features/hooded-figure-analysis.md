# Hooded Figure — eligibility, targeting, payment value, persistence & multiplayer

Build: `3abcfff` + merge of master (PR #93 docs). Code under test: `ui-source/src/state/hoodedFigure.ts`.
Everything here is the measured behaviour of the existing rules. **No probabilities, rules or balance were changed.**
Raw data: `evidence/`. Methods and exact commands: `REPRODUCE.md`.

## 0. Corrections to my first submission
1. My first five-season run used the **mock** simulator: `ui-source/src/test-setup.ts` stubs `fetch`, so the store silently falls back to `MockSimulationService`. Those records (`evidence/run-seed21-GB-MOCK-SIM-superseded.json`) are not engine results. It was re-run against the real engine adapter (`npx tsx server/index.ts`, 105 successful `/simulate-week` calls; `evidence/run-seed21-GB-REAL-ENGINE.json`). All season numbers below are from the re-run. The Hooded Figure rule logic is engine-independent, so those findings stand.
2. TAFI-002 and TAFI-009 were overstated; see the register.

## 1. Definitive eligibility assessment (Priority 1)

**What the code does.** `updateHoodedFigureStreaks` runs once per finished season. `determineHoodedFigureLosers` looks **only at human teams' outcomes**:
- if not every human team made the playoffs → the human team(s) with the lowest win%;
- if all did → the earliest playoff exit (then largest elimination margin, then win%).
A team's streak +1 if it is "the loser", else resets to 0. Eligible at streak ≥ 2 (`ELIGIBLE_STREAK`).

**Is it intended?** The *relative* rule is deliberate: the test suite is titled "§31 Eligibility" and `all human teams making the playoffs uses playoff elimination` pins §4.2. But the source spec (`11_HOODED_FIGURE_FINAL_IMPLEMENTATION_SPEC.md`) is **not in the repository**, so I could not read §4 and cannot say what it intends for one human. What I can show:
- `docs/decisions.md` and `CLAUDE.md` describe the trigger as "two losing seasons" / "the league's losing franchise two seasons running".
- No test covers a one-human league. All eligibility tests use KC + BUF.
- With one human, the rule reduces to "always the loser".

**Evidence it matters (natural, real engine, seed 21, GB).**
| Season | Record | Result | Streak after | Offered the figure next offseason? |
|---|---|---|---|---|
| 2027 | 13-4 | **won the Super Bowl** | **1** | no |
| 2028 | 5-12 | missed playoffs | 2 | **yes** ("Your team is struggling") |
| 2029 | 3-14 | missed | 3 | yes |
| 2030 | 4-13 | missed | 4 | yes |
| 2031 | 4-13 | missed | 5 | (not reached) |
The champion year counts as a losing season, so one bad year afterwards unlocks the offer. (The collapse itself is the autopilot letting the roster decay; it is not a finding.)

**Controlled:** `determineHoodedFigureLosers([15-2 champion])` → `["GB"]` (`evidence/hf-montecarlo-1800.json`, `soloChampLoser`).

**Rule comparison** (synthetic league: 32 teams, 17 games, 14 playoff spots, fixed team strength, 4,000 seasons per cell, seed 7; the real rule function is used for R0; `evidence/e1_*.json`, `e1b_cooldown.json`). Numbers are appearances per 10 seasons for one human GM:

| Config / team | R0 current | A: missed playoffs | B: below .500 | D: relative **and** missed playoffs |
|---|---|---|---|---|
| 1 human, contender (.65) | **10.0** (702 offers came right after a title) | 0.24 | 0.11 | 0.24 |
| 1 human, average (.50) | **10.0** | 3.26 | 2.48 | 3.26 |
| 1 human, poor (.35) | 10.0 | 8.58 | 8.21 | 8.58 |
| 2 humans, avg + avg (each) | ~3.0 | 3.2 | 2.5 | 1.9–2.0 |
| 2 humans, contender + poor (poor GM) | 9.35 | 8.57 | 8.03 | 8.41 |
| 4 humans, all avg (each) | ~0.95 | 3.3 | 2.4–2.5 | 0.86–0.94 |
(C = relative ∧ below .500 gave 1.6 / 7.9 / 0.74–0.87 in the same three multi cells.)

Reading it: R0 is fine for multiplayer (rare, relative, 1–3 per 10 seasons) and wrong for one human (10 per 10, even for champions). Rules A/B drift the other way for multiplayer (3 per 10 seasons for every average GM in a 4-GM league, which loses the "one unlucky franchise" feel).

**Proposed rule (not implemented): D, "the relative loser must also have missed the playoffs"**.
- Multiplayer: unchanged selection, plus a floor so a playoff team is never "the loser".
- Single player: relative loser is always the one human, so D reduces to "missed the playoffs" (3.3 / 10 seasons for an average team, 0.24 for a contender, 8.6 for a poor team).
- Streak ≥ 2 unchanged.

**Repetition and suspense.** A poor team under D still sees the figure 8.6 times in 10 seasons, 92% of them in consecutive years. A one-season cooldown halves that (4.45 per 10; consecutive-year share 0) and cooling a mid team to ~2 per 10; "streak ≥ 3" only trims it for contenders (0.04) and average teams (1.9) and does nothing for a poor team (7.94). Recommendation: D, plus an optional cooldown, subject to your approval. Whether a catch-up mechanic should visit a perennially bad team every other year is a design call; the data only shows the trade.

**Limits of this test.** Fixed team strength (no dynasty/collapse dynamics), synthetic playoff-round odds, no CPU-team effects of the figure. It measures eligibility frequency, not how the game would feel.

## 2. Event targeting, end to end (Priority 2)

| Step | What happens | How verified |
|---|---|---|
| Pay | `resolveHoodedFigureEncounter` adds `payment` to `cap.dead` and `cap.used` immediately | code + browser (`dead: 3` after $3M) |
| Swindle | seeded roll < 5%: nothing else happens | 1,800-trial run: 3.7–8% by payment, noise |
| Tier | payment vs three hidden thresholds | 1,800-trial run |
| Branch | first successful bargain in the league is forced negative; then 75% negative / 25% positive | measured 72–77% |
| **Negative target** | **a CPU team**, chosen division → conference → league, best prior record first; human teams are never targets (`selectCpuTarget`) | code (comment cites §17) + all 2,128 negative trials had a CPU target |
| **Positive target** | the payer's own roster (group boost, veteran renaissance, whole-roster, rookie) | code + trials |
| Effect | negative: players marked in `hf.unavailable` (`untilWeek` = N weeks or `null` = rest of season, playoffs included), coach fired, or whole roster out except K/P | code + browser |
| Applied in games | `HybridSimulationService.leagueRosters` filters `unavailable` by week for every game and playoff round | code + request spy (E2) |
| Cleared | when the *next* season's encounters are first created | existing test `hoodedFigureSeasons.test.ts` passes; code |

**Verdict: targeting is intentional and consistent with the code's own comments. I found no correctness defect in who is hit.** The picture the player gets is the issue:
- The offer screen says "I can help." and, correctly, "no preview of what it buys."
- After paying the player is told only "Whatever it bought, the league finds out after the preseason."
- The League Developments reveal (seen in the browser, `evidence/ui-league-developments-reveal.jpg`) is a plain card headed with the **affected team** ("BEARS") and a line of text. It never says it was your deal, so a payer must infer it. Positive outcomes appear under their own team heading, mixed with everyone else's news.
- So "who benefits or suffers" is accurate but anonymous by design (the redact tests pin this). FUN-TAFI-007.

## 3. Payment vs reward (Priority 3)

300 resolutions per payment on a disposable league (GB human, `firstNegativeConsumed` already true, seed 77, mock-generated schedule; the rival was CHI in every trial because all teams had 0-0 records in the fixture; `evidence/e4_payment_ev_raw.json`). "Felt" = the sabotaged team misses at least one game **against GB**.

| Pay | Tier 1/2/3/4 | Negative target misses a game vs you | Positive: avg total rating added | "Nothing felt" (swindle, ≤1-game absence not vs you, or boost < 3) |
|---|---|---|---|---|
| $1M | 66/33/1/0 | 9% | 6.0 | 31% |
| $2M | 52/43/5/0 | 13% | 7.3 | 31% |
| $3M | 34/54/12/0 | 16% | 8.2 | 21% |
| $4M | n/a | 23% | 7.8 | 14% |
| $5M | 9/37/47/7 | 23% | 11.7 | 16% |
| $7M | 0/14/52/34 | 40% | 12.9 | 6% |
| $10M | 0/0/0/100 | **69%** | **29.4** | 6% |

- **$10M guaranteeing tier 4 is a deliberate clamp** (thresholds are capped at 9.9, `MAX_PAYMENT = 10`). It is intended by the code; whether it is *good* is a design call. Every one of the 208 negative outcomes at $10M was **whole-roster-out** (53 CPU players, all but K/P, for the whole season including playoffs).
- **Value is strongly convex in payment**: $3M → $10M multiplies cost by 3.3 and the chance of a felt hit by 4.3, and the boost by 3.6. So the "right" answer is always "pay the most your cap allows"; the real tradeoff is only cap space. The threshold gamble disappears at the top and is a coin-flip at the bottom.
- **One-game outcomes almost never touch you.** A division rival is on your schedule about 2 of 17 weeks, so a 1-week absence lands on you roughly 12% of the time. In this fixture none of the 1-week events hit GB at all.
- **Exploitability.** A player who always pays the maximum gets a certain tier 4. That is a consequence of the clamp, not a bug. It is also the only reliable way to get a big effect.
- **K/P in group boosts:** the group is drawn uniformly from 12 groups including K and P (measured 6–21% of group boosts by payment). A kicker boost is real but rarely changes a game. FUN-TAFI-004.
- I do not propose a new payment structure: the evidence shows the structure is monotone and the issues are legibility and the K/P/1-game dead ends. Options that need approval and Agent 3's win-probability numbers are in FUN-TAFI-003/005/019.

## 4. Persistence and multiplayer (Priority 4)

| Scenario | Result | Grounding |
|---|---|---|
| Save/reload **after** paying (real page reload in the browser) | stage, payment, branch, event id, `unavailable` entry and dead money all intact | played-in-UI |
| Save/reload **before** paying | JSON round-trip of the whole league then resolving gives an identical encounter record to resolving without it | test-reproduced |
| Duplicate payment via UI/store | second submit refused: "You've already answered the figure this year." | test-reproduced |
| Duplicate payment via online `decideHoodedFigurePayment` | guard present (`existing?.resolved` throws) | code-inspected only |
| Pure `resolveHoodedFigureEncounter` called twice | **adds dead money twice** (delta = the payment); only callers guard it | test-reproduced; FUN-TAFI-016 |
| More than once per period | one encounter per team per season; eligible again each later season while the rule says so | test + code |
| Two eligible human GMs | both encounters created, both resolve independently | test-reproduced |
| Other GM's view of encounters | other GM's encounter, payment and thresholds are removed; own thresholds zeroed | test-reproduced |
| **Pre-reveal leak** | the redacted league still contains `hoodedFigure.unavailable`, which names the sabotaged CPU player ids (and so the target team). 8 of the first 12 sampled negative outcomes (38 trials total) exposed ≥ 1 id to a different GM | test-reproduced; FUN-TAFI-014 |
| `losingStreaks` | visible to all GMs, but derivable from the public season history | test-reproduced, low concern |
| Commissioner vs ordinary GM | redaction is keyed by franchise team code only; no commissioner bypass in `online/src/index.ts`. Other endpoints not read | code-inspected only |
| Preseason | an `untilWeek` filter ignores phase, so a "1-game" absence also keeps the player out of **preseason week 1** (request spy: the QB was absent in both PRE week 1 and REG week 1). Harmless to the regular season but wrong in the label | test-reproduced; FUN-TAFI-015 |
| Duration across seasons | bargains cleared when next season's encounters are created; existing test passes | existing test + code |

**Not tested (needs a browser plus a live league server):** two humans connected at once, reload mid-encounter in a live online league, the commissioner's own screens, timing/pacing of two GMs waiting on one encounter, and any rating-change visibility for positive outcomes before the reveal.

## 5. Proposed implementation approach and regression test per significant finding
| FUN-TAFI | Approach (not implemented) | Regression test |
|---|---|---|
| 001 | In `determineHoodedFigureLosers`, also require `!madePlayoffs` of the relative loser (rule D); keep the streak ≥ 2 | unit: one human, 15-2 champion → `[]`; 10-7 wild-card exit → `[]`; 6-11 missed → `[team]`; two humans keep today's selection |
| 003/005/019 | Agent 3 to measure win-probability per event; options: schedule-aware 1-week absences, cap whole-roster-out to a few weeks or a division-game count | simulation script measuring rival win% and payer win% by payment on ≥ 300 seasons |
| 004 | Exclude K/P from group-boost draw or weight by snaps | unit over 1,000 seeds: K/P share < threshold |
| 007/006 | Add a "your deal" marker on the payer's own card and a private result line after reveal | UI test that a payer's card contains the marker and others' do not |
| 014 | In `redactHoodedFigureFor`, drop `unavailable` until the reveal stage and rebuild it on the reveal | unit: after a negative bargain, the redacted view has no `unavailable` before `leagueDevelopments`; engine inputs unchanged |
| 015 | Pass phase into `filterHoodedFigureAvailable` or store `untilWeek` per phase | unit: PRE week 1 roster still contains a player out through REG week 1 |
| 016 | Make resolve idempotent (return the existing record) | unit: second call leaves cap and unavailable unchanged |
