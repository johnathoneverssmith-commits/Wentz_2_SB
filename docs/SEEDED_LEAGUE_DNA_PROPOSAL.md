# Seeded League DNA — audit and architecture proposal (for approval)

Status: **proposal only. No production code changed.** Measured on branch `claude/trusting-johnson-nlqjyu` (master at `f816efa`).
Baseline harness (scratch, not committed): full fantasy draft with 32 CPU teams, `humanGmCount: 0`, default config; then the engine's real
`strengthIndex` per roster plus 17 simulated games per team at the default Amplified talent (1.5). 24 seeds.

## 1. Current implementation findings

| # | Question | Finding |
|---|---|---|
| 1 | Pool construction | `generateInitialPool` (`ui-source/src/sim/MockSimulationService.ts:417`) returns the **committed real-player file** `ui-source/src/data/pool-2026.json` (1,987 players) plus generated depth filler (seeded). `normalizePool` then makes everyone a free agent for the fantasy draft. |
| 2 | Real data | Player names/teams/ages from nflverse and **authored ratings** (e.g. a named star EDGE at 98). Real coaches too (`staff-data.ts`). The engine's own reference teams (`artifacts/**/portable`) are real-roster based and used by analysis scripts and as a fallback. |
| 3 | Distributions (shipped pool) | Position means 70.7–72.9 (K/P ≈ 79), sd 5.7–7.8 (QB 9.8). 90+ players by position: QB 12, WR 20, EDGE 14, OT 12, DT 12; C only 2. Mean age ≈ 26–27 (QB 28.3). **Initial players have no `potential`** (only rookies do), so they age on the generic curve. |
| 4 | Names / rookies | `names.ts`: ~80 first × ~100 last names (~8k combos, collisions already handled by suffixing). `generateDraftClass(seed, year, tilt)`: 320 prospects, rng `imul(seed,…)^(0x4444+year)`, positions from a round-based mix, `trueOverall` from the measured draft-outcome curve + a **tilt**. Rookie attributes are drawn from `ATTRIBUTE_FIT` (residual sd only 1–4). |
| 5 | Fantasy-draft AI | `rules.ts` `runAiPicks`/`planAutopicks`: base value = overall + `POSITION_VALUE` (measured, `draftBoard.ts`), then difficulty (search depth/noise), then GM strategy bonus, then roster-floor constraints. Every CPU team uses the same base evaluator. |
| 6 | Ratings → strength | Two paths. Engine (`ratings.ts` rating families from **attributes**, `team-strength.ts` snap-weighted **overall** index, `synergy.ts`), scaled by `talentScale`. UI `recomputeTeamRatings` is a display proxy. |
| 7 | Unit grades / archetypes | **No archetype concept exists.** Attribute-driven mechanisms that *do* matter: QB mobility, kicker leg, returner (`synergy.ts`), rating-family betas on ~25 attributes per position group. |
| 8 | Aging | `careerShape(id)` is derived from a hash of the player id (stable for any new id). Per-player `dev_age_threshold`/`decline_age_threshold`, optional `potential` ceiling. **Balancers pull each position back to the initial league's starter means** (`draftSupply.ts`, see risk R1). |
| 9 | Contracts / valuation | `contractValue.ts`, `faValue.ts`, `unitValue.ts` all read overall/age/potential/position — generic, no dependence on who the players are. |
| 10 | Persistence | Whole `LeagueState` JSON (single-player persisted store with `CURRENT_SAVE_VERSION = 4`; online stores it in Postgres). `players` is a map keyed by id. Online seed = `Date.now() % 100000` (17 bits). Filler ids come from a **module-level counter** (`nextPid`), so they depend on process history, not only the seed. |

## 2. Baseline: post-fantasy-draft parity (24 seeds, 32 CPU teams)

| Metric | Mean over 24 seeds |
|---|---|
| Team-strength index sd (engine units, 0–99 scale) | **0.31** (range 0.28–0.37) |
| Strongest minus weakest team | **1.32** index points |
| Top 8 minus bottom 8 | **0.79** |
| UI team overall sd | 0.92 |
| Simulated 17-game average margin sd across teams | 4.7 pts (≈2.3 of this is pure sampling noise) |
| Points per team-game / sd | 23.4 / 9.4 |
| 90+ rated players: overlap between two different seeds | **55 of 55 — identical** |

Reading: a league of 32 teams that differ by ≈1 index point is nearly a coin-flip league; the owner's impression is correct.
Different seeds currently produce **the same stars**; the seed only changes filler depth, draft order and which CPU GM gets which strategy.

Strategy outcomes (8 CPU strategies, 96 team-drafts each, same sim): mean margin high_floor +2.8, pass_heavy +2.6, balanced +2.0,
trenches_first +1.7, offense_heavy +0.8, defense_heavy +0.4, run_heavy −0.3, high_ceiling −0.6. Strategies already differ by ~3 points,
but **the ordering is the same in every league** because the pool is the same. Hand-scripted drafters (QB-first, OL-first…) are a
Phase 6 deliverable; they need a scripted-human pick hook and are not measured yet.

### Where the parity comes from (hypotheses ranked, not yet proven)
1. **Identical pool + one shared evaluator.** All 32 teams run the same valuation in a snake draft, so total drafted "value" equalises by
   construction. Spread can only come from the gap between draft value and sim value (position premiums vs. real sim effect, synergy, depth).
2. **Thin, uniform talent shape.** Positional means within ~2 points, few outliers per position. With the same star list every league,
   there is no scarcity to exploit; a player-generation change helps here, and is the only lever in scope.
3. **Sim sensitivity** is already amplified (1.5×) and fitted to real football (favourite wins ~72%); I do not propose touching it.
4. Roster-need floors (`DRAFT_FLOOR`) force breadth, which compresses strategy extremes.
Planned test before building: run the same draft on synthetic pools with widened/shifted positional dispersion (no game-code change)
and measure how much of the 0.31 sd moves. If pool changes alone reach only a modest sd, I will report that and ask for separate approval for any gameplay lever.

## 3. League DNA generation algorithm (proposal)

Versioned module `ui-source/src/sim/leagueDna/` (pure, no sim RNG). `GEN_VERSION = 1` stored on the league.
- **Streams.** `dnaSeed = hash32(seed, "dna", GEN_VERSION)` (new 32-bit field; the 17-bit online seed is only an input). Independent
  child streams by hashing labels: `dna/league`, `dna/pos/<POS>`, `dna/player/<slot>`, `dna/names`, `class/<year>`. A stream never reads
  another's state, so adding a position or reordering generation cannot shift anyone else.
- **League-level draw (~10 latent factors).** overall talent level, tail heaviness (elite frequency), age tilt, development-upside level,
  plus a small correlated vector over 5 *groups*: QB/passing game, receivers, OL, front-7, secondary, RB/TE. Correlation structure fixed
  (e.g. QB↔WR positive, OL↔RB weakly positive, DL↔DB weak negative) so environments are coherent, not independent noise.
- **Per-position parameters** from the factors: mean shift (bounded ±3), sd, tail weight (elite count), depth thickness (replacement
  floor), age mean, upside mean. Hard clamps keep every position able to fill 32 × template (supply ≥ ~1.15× demand at ≥60 overall).
- **No outcome bias.** DNA changes *what exists*; it never assigns players to teams or changes any game parameter.

## 4. Player attributes and archetypes

- Per player: draw archetype for the position (weights shifted by DNA), then **latent traits → attributes** using the existing attribute
  keys per position (`ATTR_KEYS`, `ATTRIBUTE_FIT`). Archetype = a correlated attribute offset pattern with real engine consequences, e.g.
  QB: pocket passer (accuracy/awareness up) vs mobile (speed/agility, feeds `qbMobilityZ`) vs gunslinger (arm up, ball-security down);
  OT: pass-protector vs road-grader (pass_block vs run_block); EDGE: speed vs power rusher; CB: press vs zone; RB: power/elusive/receiving.
  Each archetype must cite the attributes/engine terms it moves; any archetype with no measurable engine effect is dropped (test-enforced).
- **Overall is derived**, not drawn: position-specific weighted attribute formula fitted by regression on the shipped pool
  (new `analysis/` script) so the scale matches today's ratings. This keeps overall and attributes consistent.
- `potential`, `dev_age_threshold`, `decline_age_threshold` generated for every player (existing schema fields), compatible with
  `careerShape`, PD-1/2/3 untouched.
- Names: syllable/composed generator (>10⁶ combos) with a league-wide uniqueness registry; new `p_g<gen>_<n>` style stable ids derived
  from `(dnaSeed, slot)` not a global counter. No real-name list is used; a denylist check against the shipped real-name set guards against
  accidental collisions.
- Rare talents: explicit elite/generational tail from the DNA's tail parameter (counts vary per league and per position).

## 5. Historical-era matching (generate first, then describe)

1. Compute a **fingerprint** of the generated pool: positional z-scores of starter-level talent, elite counts per group, archetype mix
   (e.g. mobile-QB share, power-back share), age profile.
2. Compare to a small catalogue of **era fingerprints** by nearest-distance with an explicit distance cutoff; beyond the cutoff,
   output a fictional-era description. Output also holds the 2 strongest/weakest tendencies for the blurb.
3. **Honest limit:** no reputable public source gives *player-rating* distributions for old eras (that is EA data, excluded). Era
   fingerprints can only be built from public aggregate stats (pass rate, rush share, sack and scoring levels; [PFR league
   averages](https://www.pro-football-reference.com/years/NFL/), [NFL Operations on scoring](https://operations.nfl.com/gameday/analytics/stats-articles/where-have-all-of-the-nfl-points-gone)).
   My preliminary check supports only coarse statements: scoring rose from ~22.0 (2010) to a then-high 23.4 (2013), 2020 hit 24.8, and the
   2024–25 decline is documented; I found no clean 2005/2011 rush-share figures in this pass. Mapping those to *talent emphasis* is
   therefore a labelled heuristic ("resembles", never "is"), tied to stat-derived emphasis scores, not verified ratings.
   **Decision needed:** approve a catalogue of ~6 eras (e.g. 2005, 2011, 2013, 2020, a recent run-balanced era, plus fictional fallback)
   after I assemble and cite the stat tables in Phase A of implementation.
4. Player-facing text: broad qualitative tendencies only (deep / limited), never exact counts or ratings; no recommended strategy.

## 6. Independent future rookie classes

- `ClassDNA(year) = draw(hash32(dnaSeed, "class", year))`: its own class-quality level, per-position strength (independent of the opening
  DNA, only a weak shared "league culture" term, ≤15% weight), tail size (including rare weak/great years), age and upside tilt.
- Generated lazily and deterministically from `(dnaSeed, year)`; a class never depends on earlier gameplay RNG. Old classes are pure
  functions, so save/reload reproduces them; the generated prospects are already stored in state once the class exists.
- Replaces `generateDraftClass`'s position mix with ClassDNA-modulated mix **for new-DNA leagues only** (`GEN_VERSION >= 1`); legacy
  leagues keep the old function byte-for-byte.
- Class scouting blurb is computed from that class's measured distribution (same descriptor engine, no era label).

## 7. Compatibility and persistence

- Additive fields on `LeagueState`: `dna?: { version, dnaSeed, profile }`. No DB migration (state is already JSON); online
  `createLeague` just also stores it. Save version bump only if the migration test requires it.
- Absent `dna` ⇒ legacy path everywhere (real pool, old class generator). Loading a save never regenerates players.
- Leagues are tagged at creation; "new leagues use fictional pool" gated by a setting and a version constant so future rebalances are
  new `GEN_VERSION`s.
- **R1 (important): `positionBaseline`/`agingBalance`/`draftClassTilt` steer every position back to the opening league's starter means.**
  With seeded DNA that would erode the very scarcity we generate and fight independent classes. Proposal: for DNA leagues, baseline
  against a *neutral global target* (not the league's own opening state), with a weaker restoring force. This touches the aging/draft
  balancing code (PD-1/2/3 neighbours) — **needs your explicit approval**; I will not change it silently. Evidence-first: the 15-season
  tests will show drift before/after.
- Engine reference rosters and analysis artifacts stay as-is (they are calibration data, not game data).
- UI-4/UI-5: only a new read-only `scoutingSummary` selector and one component slot in the draft room; no edits to their screens.
  Privacy: summary derived from broad bands server-side/online; exact distributions/potential never put in public state fields.

## 8. Acceptance criteria and risks

Acceptance (measurable): same seed+version ⇒ byte-identical pool; ≥20 seeds differ (elite-name sets, per-position means differ beyond
noise; star overlap < 5%); unique ids/names (100%); each position supplies ≥1.15× roster demand; post-draft team-strength sd
and strongest–weakest reported against the 0.31 / 1.32 baseline *without* requiring a target; 15–20 season runs keep rosters legal, no
position thinning, elite supply within a stated band; class-to-class position strength varies (e.g. coefficient of variation > floor) and
classes are independent of the opening DNA; legacy saves load unchanged; online two-client determinism; CPU competitiveness
(Master vs Expert benchmark stays inside noise); existing suites + CI green.
Risks: (R1) balancer coupling above; (R2) parity may not move much from pool changes alone — will be reported, not forced;
(R3) attribute-derived overall can shift scale ⇒ regression-fit + distribution tests; (R4) era-matching credibility ⇒ coarse, labelled,
fictional fallback; (R5) CPU draft/AI tuned to the current pool (e.g. `POSITION_VALUE`) may behave differently on scarce positions;
(R6) `passing-volume` statistical baseline will need re-measurement (only with approval, same commit); (R7) performance of 2,000-player generation (cheap).

## 9. Implementation phases

A. Era evidence + fingerprint catalogue (docs/analysis, no game code) → B. generator core (streams, DNA, names, archetypes, derived
overall, potential) with unit/statistical tests, behind a flag → C. pool-variance experiment and parity measurement → D. wire into
`createLeague` for new leagues + versioning/persistence → E. ClassDNA rookie classes (+R1 decision) → F. scouting summaries + UI slots
(coordinate with UI-4/5) → G. strategy tournament (scripted drafters, 20+ seeds), 15–20 season runs, CI/Postgres/E2E → PR.
Dependencies: B before C–G; R1 approval before E; era catalogue approval before F.

## Decisions requested
1. Approve the architecture above (and the sequencing: pool-variance experiment *before* wiring in).
2. Approve touching `draftSupply.ts` baselining for DNA leagues only (R1).
3. Approve the era-matching approach as coarse/heuristic with a fictional fallback, and the plan to cite public stat tables.
4. Confirm new-leagues-only (existing franchises keep today's real-name pool).
