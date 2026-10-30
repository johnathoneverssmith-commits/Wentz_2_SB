# Seeded League DNA

New leagues play **original fictional players** whose talent environment is drawn from the league's seed. This
file is the as-built reference and the evidence. The design proposal and baseline audit are in
`docs/SEEDED_LEAGUE_DNA_PROPOSAL.md`; the era catalogue and its limits are in `docs/LEAGUE_DNA_ERAS.md`.

## What it is

| Piece | Where | What it does |
|---|---|---|
| Streams | `ui-source/src/sim/leagueDna/streams.ts` | `dnaSeed = hash(version, seed)`, 32 bits even when the league seed is 17. Every stream is `hash(dnaSeed, label...)`: `league`, `pos/<POS>`, `player/<POS>/<i>`, `name/...`, `deal/<POS>`, `class/<year>[/<POS>]`. Nothing reads gameplay RNG; one stream never advances another. |
| League DNA | `dna.ts` | A correlated draw: overall level, tail heaviness, age tilt, developmental upside, and per position a mean shift, spread, elite-tail weight, depth, and archetype mix. Offence and defence factors sit under seven groups (passing, receivers, line, backfield, front, secondary, specialists), so a deep QB class tends (not always) to come with receivers. |
| Scoring guard | `dna.ts` (`SCORING_WEIGHT`) | Net offence-minus-defence pull is projected into a band. Unconstrained, league scoring ran 17-32 points a game; now about 19-29 (sd 1.8, floor ~1.4 from sampling). It moves talent between sides of the ball; it does not touch any team. |
| Players | `generate.ts`, `identity.ts`, `archetypes.ts` | A player is a pure function of (dnaSeed, position, index). Original composed names, unique in the league and kept clear of every shipped real name. Attributes come from the position's fitted shape (`attributeFit.ts`) plus an archetype and one personal strength and weakness. Careers use the rookie frame (`dev = entry + 4`, decline from `RETIREMENT_AGE`) and a hidden `potential`, so PD-1/2/3 and `careerShape(id)` treat them like any rookie. Ids: `p_g1_<6 hex>_<POS><nnn>` - no process counter. |
| Archetypes | `archetypes.ts` | 31 types over 13 positions (pocket / dual-threat / gunslinger QB, power / speed / receiving back, pass-protector / road-grader tackle, speed / power rusher, man / zone corner, box / deep safety, ...). Each lists boosts and costs on attributes the engine reads (`archetypes.test.ts` fails if a type touches none). Overall is unchanged by a type. |
| Deal | `generate.ts` (`dealToTeams`) | Players are dealt onto teams best-first in a randomly ordered snake (so the non-fantasy-draft start is fair); `home_team` is kept so switching the fantasy draft off restores it. |
| Profile | `profile.ts`, `eras.ts` | Read from the generated pool: starter-level talent by group -> bands (`exceptional/strong/average/limited/scarce`) -> the nearest of five era analogies, or a fictional-era title beyond a cutoff. Text names broad strengths and weaknesses only. |
| Class DNA | `classDna.ts` | `classDnaFor(dnaSeed, year)`: its own quality, tail, per-position strength/supply/archetype mix. Shares only 12% of the opening league's tendencies. `generateDraftClass` takes it as an optional fourth argument; legacy leagues pass nothing and get the old function byte for byte. |
| Class profile | `classProfile.ts`, `state/classProfile.ts` | A scouting report from the class's own measured distribution, stored on `draftClassProfile` where true ratings are visible (the server online, which zeroes `trueOverall` for clients). No era label. |
| Balancing | `state/draftSupply.ts` | DNA leagues steer to a **neutral long-run target** (`targets.ts`), with a weaker restoring force and no integral term; legacy leagues are unchanged. `DNA_BALANCE` holds the gains. |

## Compatibility

* `LeagueState.dna` (version, seed, public profile) is optional. **Absent means a legacy league**: real-player pool, old
  rookie classes, old balancing. No migration, no schema change, no save-version bump; loading a save never
  generates or replaces a player.
* `LeagueConfig.playerPool: "legacy"` keeps the real pool for tests and tools. Default is fictional.
* Seven tests whose scenarios depend on one real pool (seed-specific trade/FA/turn-order setups, a pre-`home_team`
  save) are pinned to `"legacy"`; everything else runs on the new default.
* `GEN_VERSION = 1`. A rebalance is a new version; a league keeps the version it was made with.

## Evidence

Every number below is from this branch's own harnesses (local runs; CI is the authority for tests).

**Pool variance vs post-draft parity** (`scripts/league_dna_parity.ts`, 24 seeds x 32 CPU teams x full fantasy draft,
engine strength index, 17 simulated games per team):

| | legacy real-player pool | fictional (final) |
|---|---:|---:|
| team-strength index sd | 0.313 (0.28-0.37) | 0.325 (0.27-0.38) |
| strongest - weakest | 1.32 | 1.34 |
| top 8 - bottom 8 | 0.79 | 0.83 |
| simulated margin sd (17 games) | 4.69 | 4.12 |
| points per team-game (sd) | 23.5 (9.5) | 24.5 (9.2) |
| 90+ players shared between two leagues | 100% (55 of 55) | 0.1% |

**The pool by itself does not widen parity.** All 32 teams draft with one evaluator, so the variance a draft can add is
bounded by how that evaluator misprices the pool, and a different pool does not change that. Per the approval, no
drafting or simulation change was made; see "What this does and does not fix" below.

**Strategy diversity** (`scripts/league_dna_strategies.ts`: one seat drafts by a scripted rule against 31 CPU teams;
strength-index change vs the CPU mean; 6 strategies):

| | legacy | fictional |
|---|---:|---:|
| seeds | 20 | 20 |
| best strategy by seed | qb_first 10, bpa 8, defense_first 2 | bpa 10, defense_first 5, qb_first 3, ol_first 2 |
| rank agreement of the strategy order between two seeds (Spearman) | 0.78 | 0.32 |
| best minus worst strategy (index points; CPU sd is 0.3) | 2.4 | 2.0 |

Simulated (34 games, 8 seeds): best by margin legacy qb_first 7 / defense_first 1; fictional qb_first 5 / bpa 2 /
dl_first 1; rank agreement 0.74 vs 0.19; index change tracks margin (r = 0.58-0.75). The scripted drafters are
weaker than the CPU drafter in absolute terms (they sit 1-3 index points below the CPU mean), so read these as
*relative* comparisons between strategies, not as "the CPU is beatable this way".

**Long-run stability** (`online/test/league-dna-longrun.test.ts`, 4 leagues x 15 seasons through the server's stage
machine, fantasy draft first):

| | legacy | fictional |
|---|---|---|
| 85+ players in year 3 / 9 / 15 (range over 4 leagues) | 173-193 / 94-109 / 49-66 | 126-278 / 209-242 / 167-198 |
| 90+ players, year 15 | 9-20 | 58-80 |
| late starter mean vs neutral target, by position | -3.0 to -8.4 | -2.4 to +1.8 |
| roster size, every team, every year | 53 | 53 |
| class quality sd across years | 1.4 | 1.8 |
| class position-strength sd across years | 3.9 | 5.3 |
| corr(opening QB strength, later class QB strength) | -0.04 | 0.11 |

(An earlier generator, before the scoring guard, ran 2 leagues x 20 seasons: starters within -2.9/+0.2 of target, 85+
players 163-261, no drift.) DNA leagues sit above the legacy equilibrium because legacy's controller deflates it; the
DNA offset (`DNA_BALANCE.offset`) was chosen so 85+ players plateau at roughly 1.5-2x the opening pool's count (135) rather
than 2.5x.

## What this does and does not fix

* It **does** make leagues different (stars, scarcities, archetype mix, scoring character, class cycles) and it
  **does** make the best way to draft vary from league to league (rank agreement 0.78 -> 0.32).
* It **does not** make the CPU-drafted league less even: the 0.31-0.33 team-strength sd is a property of 32 teams
  drafting on one shared valuation, not of the player pool. If more post-draft spread is wanted, the levers are in
  the draft evaluator (e.g. per-GM valuation differences), not here, and they are a separate decision.
* Best-player-available stays the single most reliable scripted approach in most leagues; the pool changes how
  often a position-led plan beats it, not that BPA is sound.

## Known limits

* `potential` is **server-private**. The saved league keeps it (aging, camp, contracts and trades run on the server);
  the league route removes it from every player before sending (`online/src/privacyView.ts`), with no rounded or
  noisy stand-in. A client prices a player on the league development curve for his age, which is what
  `contractValue.ts` already does for a player with no ceiling. Single-player keeps everything locally, as before.
  Tests: `online/test/potential-privacy.test.ts` (unit, and the real route against the saved league).
* `dnaSeed` is derivable from the league seed by anyone with the source, so a determined cheater could regenerate
  future classes. Draft prospects were already generated from the league seed, so this is the same exposure as before.
* The era catalogue is qualitative (`docs/LEAGUE_DNA_ERAS.md`).
* Neutral DNA plays about 0.9 points a game above the validated engine (24.3 vs 23.5 on real rosters).
