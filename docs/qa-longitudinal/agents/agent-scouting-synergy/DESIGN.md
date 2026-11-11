# DESIGN — Scouting, Skill-Style Synergy and Scheme Identity

Status: **proposal, not approved, nothing implemented.** Baseline `master` @ `d0727ff`. Evidence: [EXPERIMENTS.md](EXPERIMENTS.md). Presentation: [UI-PROPOSAL.md](UI-PROPOSAL.md). Phasing: [IMPLEMENTATION-ROADMAP.md](IMPLEMENTATION-ROADMAP.md). Risks: [RISKS.md](RISKS.md).

Design principle (from the brief): *the best franchise should be the one that most intelligently identifies, develops, combines and uses its players, not the one that buys the highest overalls.* Every mechanic below is justified by a decision it creates; a mechanic that creates no decision is cut.

---

## 0. What the audit found (facts the design stands on)

| # | Fact | Where | Why it matters |
|---|---|---|---|
| F1 | A prospect's hidden rating is `E[rating \| board slot] + independent noise` (σ 5.7 at the top of the board, 12.5 at the end). The visible grade `collegeOverall` is generated from the same slot plus its own noise, **not from the hidden rating**. | `MockSimulationService.generateDraftClass`, `sim/draft-outcomes.ts` | Today there is *nothing to find out* beyond the slot. Scouting is only predictive if it reveals the part of the rating that public information cannot see; that latent term (ε) must be defined, then revealed through noisy reports. |
| F2 | A rookie's full attribute profile, archetype and hidden `potential` are generated **at signing**, from `new Rng(fnv(prospectId))` plus `fittedAttributes(position, trueOverall, …)`. | `state/rules.ts upsertRookiePlayer` | They are already deterministic per prospect. A scouting preview can replay the same draws and show exactly what signing will later produce, so **a scouted profile can never contradict the signed player**, with no change to existing outcomes. |
| F3 | The engine's synergy (`src/engine/synergy.ts`) is built from **one scalar skill z-score per player per job** (e.g. `RUNNER`, `RUN_BLOCK`, `QB_PASS`, `RECEIVING`), combined by a pairwise term `J(a,b) = min·\|max\|`. Two players with the same skill score but opposite *styles* (an elusive back vs a power back) are indistinguishable. | `synergy.ts` | "Complementary" is not representable today; only "both good". |
| F4 | RB × line is already priced, weakly (`runnerLine` weight 0.015) and the RB×OL quality interaction measures as additive in the real engine (A, Part 1). | `SYNERGY_WEIGHTS`, EXPERIMENTS A | The brief's example ("elite RB behind elite OL should sometimes beat the additive expectation") is *not true today*. |
| F5 | Scheme fit exists (`staff-fit.ts`) but compares `scheme_tags` on players with a coordinator's scheme tag list, a binary overlap fraction. **Every player in a default (fictional-DNA) league, and every drafted rookie, has `scheme_tags = []`.** With no tags, a non-neutral coordinator scheme is scored against an empty roster and takes a flat penalty relative to the league baseline (zone_run: −0.21 yd/carry, −0.04 completion logits; measured in D1). | `staff-fit.ts`, `rules.ts` (`scheme_tags: []`), probe of a default league: 0 of 1,696 players tagged, 1,696 of 1,696 have an `archetype` | The existing "scheme" decision is partly inert and partly a trap. This is a defect to fix **before** building on it (Phase 0). |
| F6 | The game plan (`gameplan.ts`) has 15 dials, almost all of them zero-sum around the standard plan; only run-heavy has a reliable opponent-specific effect (PR #105 X4). | `gameplan.ts`, PR #105 | Weekly tactics currently have too little to decide. |
| F7 | Archetypes already exist for every position (Pocket passer/Dual-threat/Gunslinger, Power/Speed/Receiving back, Deep/Possession/YAC receiver, Pass protector/Road grader, Speed/Power rusher, Run-stuffer/Coverage linebacker, Man/Zone corner, …) and change attributes while holding overall fixed. | `sim/leagueDna/archetypes.ts` | The style vocabulary the player-facing game needs **already exists in data**. No new attributes are required. |
| F8 | PR #105: perfect information is worth ≈ +1 rating / +1.2 wins per season after three drafts; visible information does not beat the CPU; a position-blind draft costs ≈ 1 win. The Draft Room leads with the college grade (overstates by ≈ 15, r ≈ 0.5). | PR #105 X2, `DraftRoom.tsx` | The size of the prize for scouting is bounded (about 1 win/season at *perfect* information). A good scouting system should capture a fraction of that, not more. |

---

## 1. Part 1 — Scouting

### 1.1 The information model

Every hidden quantity gets a **public prior**, and scouting adds a **noisy measurement** of the part the prior cannot see. Nothing ever reveals an exact value.

For prospect *i*:

* `E_pub,i` = today's public projection (`expectedRatings(prospects, 1)`), what the CPU already reads.
* `ε_i = trueOverall_i − E_pub,i`: the part public information cannot see.
* A scouting report at tier *t* is `r_i = ε_i + N(0, σ_t²)` with `σ_basic = 7`, `σ_advanced = 3.5` rating points.
* The displayed estimate is the posterior mean `ê_i = E_pub,i + k_i · r_i`, `k_i = τ_i² / (τ_i² + σ_t²)`, where **τ_i is the measured residual spread at the prospect's public rank**: 6.6 (ranks 1–32), 7.7, 8.7, 8.9, 10.0, 10.4, 11.0, 11.0, 11.2 (ranks 225+), measured on 9,600 generated prospects (30 classes; mean residual +0.07, i.e. the public projection is unbiased). So a report moves a late prospect's estimate more than a top prospect's (k = 0.71 vs 0.47 at σ = 7), which is exactly where the public projection knows least.
* The displayed **range** is `ê_i ± 1.28·s_i` with `s_i = sqrt(τ_i²σ_t²/(τ_i²+σ_t²))`: for a rank-50 prospect public ≈ ±11, basic ≈ ±6.9, advanced ≈ ±4.3 rating points (an 80% interval, shown as a bar and a confidence word, not a number the player must interpret).

Properties this guarantees: (a) a report is *useful* (it moves the estimate by `k_t ε` on average and shrinks the interval); (b) it is never exact (even advanced leaves ≈ ±4); (c) it is *calibrated* (the interval contains the truth ≈ 80% of the time, which a regression test can assert); (d) repeated scouting of the same prospect at the same tier returns the **same** report (seeded by `(league seed, prospect id, tier)`), so there is no re-roll exploit.

`ε` is not stored. It is a pure function of the class (`trueOverall − E_pub`), so the hidden rating, the signing and every existing code path are unchanged.

### 1.2 What each tier shows

| | Public (free, all prospects) | Scouted (**basic**, 1 report) | Advanced (**deep**, 3 reports; includes basic) |
|---|---|---|---|
| Projected rating | broad range (≈ ±9.6) | narrower (≈ ±6.5), better centre | narrow (≈ ±4.3) |
| Physical / production | height, weight, 40, projected round, college production **(demoted; labelled "college production, not a pro rating")** | same | same |
| Skill read | role label with confidence ("Looks like a power back — likely") | role confirmed; **3 skill grades** (position-specific bands, see §1.3) | all position skills in 5-point bands |
| Scheme compatibility | – | compatibility with *your* identity: Good / Mixed / Poor, low confidence | same with high confidence and the reason ("quick-twitch; your line is gap-blocking") |
| Development | – | risk label: Safe / Normal / Boom-or-bust | floor / expected / ceiling bands and a development-speed label |
| Confidence | "Public information only" | Medium | High (never "certain") |

The three skill grades per position come from groupings the engine already scores (`RUNNER`, `RUN_BLOCK`, `QB_PASS`, `RECEIVING`, `COVERAGE`, `PASS_RUSH`, …) and from the style axes of §2; no new attribute is introduced.

### 1.3 Skill-specific evaluation (examples of the three grades)

QB: arm (deep/power) · accuracy (short–mid) · mobility. RB: vision/elusiveness · power · receiving. WR: separation (routes) · vertical (speed/deep) · hands. OL: pass set · run drive · mobility. EDGE: speed rush · power rush · run defence. CB: man/press · zone/instincts · ball skills. Each is a noisy read of the true attribute composite (`σ_skill` 6 basic / 3 advanced), banded to 5 points.

### 1.4 The resource economy

* **Scouting points**: **30 per team per offseason** (Phase 1, flat). Basic = 1, advanced = 3 (advanced replaces, not adds to, basic). A team can therefore advanced-scout 10, or basic-scout 30, or mix.
* A later phase (optional, Phase 5) ties points to a **Director of Scouting** hired in the existing coaching draft (rating 20–95 → 24–42 points), so a human can *invest* in information with the same machinery as other staff. This is the only cap/market cost; there is no separate scouting currency to manage.
* Points do not roll over, are not tradeable, and are spent during the existing pre-draft stages. The scouting screen is one screen with one budget bar; reports unlock instantly and can be revisited free.
* Interaction with the draft: the Draft Room shows the **best available estimate** for every prospect, with the tier badge. Unscouted prospects keep the public range, so skipping a position is visible.

Why not more granularity: no scouting trips, no per-region staff, no interviews. Experiment C shows the whole value comes from *which prospects get a deeper read*; further sub-mechanics add taps, not decisions.

### 1.5 Avoiding the dominant "scout the top of the board" strategy

The marginal value of a report is `P(this prospect is a pick I would actually make) × (variance removed) × (positional leverage)`. Variance is highest late (σ_slot 12.5 vs 5.7) but the chance a late prospect is *the* choice is small; the top of the board is the opposite. The product peaks in the middle of the team's own pick window, and the best targets depend on need and pick position, so "scout the top-N" is not optimal (verified in Experiment C: top-of-board scouting under-performs window and need-targeted scouting at equal points). This is a **result to be confirmed in the prototype numbers, not assumed**; if top-N turned out to dominate, the point costs would be re-weighted (cost ∝ board rank) before shipping.

### 1.6 CPU use of scouting

CPUs get the same model and the same menu, never more. Points by difficulty: Casual 12, Standard 24, Competitive 30, Expert 36, Master 36 (=human). They spend them with the *window* heuristic (the prospects ranked near their own first picks, at positions they need) and then draft by `ê × positionValue × strategy`, i.e. the existing `planAutopicks` with `ê` replacing `E_pub` for scouted prospects. This keeps CPU competition credible, makes difficulty a *information budget* rather than hidden advantage, and leaves Master identical to Expert in information (its edge remains the evaluator).

### 1.7 Interactions with existing systems

* **Draft classes / League DNA**: `ε` and the style profile derive from the class; `classProfile` strength/weakness already shifts trueOverall; no change.
* **Player development**: the revealed `potential` band is a noisy read of the existing hidden `potential`; `dev_age_threshold` is deterministic from age. Training camp and aging are untouched.
* **Fantasy draft**: uses current veterans with fully visible ratings; scouting does not apply. The fit and compatibility indicators of §2 do apply (that is where "highest overall" vs "best fit" is a live choice).
* **Fictional generation**: nothing new is generated. The ε-latent is the existing generator's noise, re-read.
* **Existing franchises**: the prospect pool for the *current* class already exists in every save; scouting works on it immediately (details in the roadmap).

---

## 2. Part 2 — Skill-style synergy

### 2.1 Style axes: derived from existing attributes

A **style axis** is a signed z-score difference between two weighted groups of existing attributes. Axes are standardised against the same reference pool as the rating layer.

| Axis | + side | − side | Players |
|---|---|---|---|
| Run style | elusive: `ball_carrier_vision .4, agility .2, juke_move .2, acceleration .2` | power: `break_tackle .4, stiff_arm .3, strength .3` | RB |
| Line style | mobile: `agility .5, acceleration .25, speed .25` | drive: `strength .5, anchor .3, pass_block_power .2` | OT/OG/C |
| QB style | vertical: `throw_accuracy_deep .5, throw_power .5` | quick: `throw_accuracy_short .6, awareness .4` | QB |
| Receiver style | vertical: `route_running_deep .4, speed .3, acceleration .3` | timing: `route_running_short .4, catching .3, release .3` | WR |
| Front style | stout: `run_defense .4, strength .3, block_shedding .3` | quick: `speed .3, acceleration .3, finesse_moves .4` | EDGE/DT |
| Coverage style | man: `man_coverage .5, press .5` | zone: `zone_coverage .7, play_recognition .3` | CB/S |

All are already generated for every player (and shifted by archetype), so the axes work on existing franchises and new classes. **No new attribute.**

**Each axis is standardised against the same position group's reference starters** (mean 0, sd 1, clamped to ±2). The first prototype standardised against the whole player pool, and offensive linemen then read as "drive blockers" by −1.7 z on average merely because linemen are strong compared with receivers; every line sat at the clamp and the fit term saturated (found by the prototype diagnostic `harness/diag_fit.ts`). Within-position standardisation is therefore a *requirement* of the design, not a detail.

### 2.2 Quality × alignment (why this is more than adding ratings)

For each unit the **fit** is

```
fit = exec · F(q) · (A − A_ref),     F(q) = clamp(1 + 0.8·(q − q_ref), 0.3, 2.0)
```

* `q` is the unit's existing skill z-score (mean of `RUNNER` and `RUN_BLOCK` for the run game), `q_ref` the mean over the 32 reference rosters. A unit at the league norm has `F = 1`; an elite unit (q ≈ +1.2 above norm) has `F ≈ 2` (so the same alignment is worth about twice as much), and a poor unit's fit is worth almost nothing. That is how "elite RB behind an elite line" can earn more than the sum of its parts, **but only if the two are aligned**: alignment without quality is worth ~0, quality without alignment is the engine as it is today.
* `A` is alignment: how well the unit's styles agree with each other and with the declared concept (§3): for the run game `A = c_run·(s_RB + s_OL)/2 − |s_RB − s_OL|/2`, for the pass game `A = c_pass·(s_QB + s_WR)/2 + 0.5·c_vertical·q_protect − |s_QB − s_WR|/2`, for coverage `A = c_cov·s_cov`. `A_ref` is the reference mean of the coherence penalty, so an ordinary roster's alignment term is **zero before it is multiplied by quality** (the first prototype multiplied an uncentred, negative-mean `A` by a rising quality term and so penalised every good unit; also found by the diagnostic).
* `exec ∈ [0.6, 1.4]` is the coordinator's execution factor (§3.3).

Fit enters through the **same three channels** the engine already moves (completion, sacks, rush yards) and is subject to the **same saturation** (`tanh` ceilings) and the **same reference centring** (a league-average roster nets zero), so league scoring levels do not move.

### 2.3 Counters (opponent interaction)

```
counter_run  = c_run  · front_style_opp         (zone wants a stout/slow front to stretch; power wants a quick one to move)
counter_pass = c_pass · coverage_style_opp      (vertical wants man/press to beat deep; timing wants zone; press disrupts timing)
```

Small weights (a quarter of the fit weights) so identity matters more than any single week's opponent (Experiment D shows that an all-in weekly counter that abandons the roster's identity loses). Every concept is good against something and bad against something else: no universal best.

### 2.4 Defence

Coverage fit (man vs zone personnel with the DC's scheme) as above; run defence and pass rush keep their existing terms (`dlRun`, `lbRun`, `passRush`, `rushCoverage`, `pressure`), which already combine well. The front style is read by the opponent's counter term. Linebacker "downhill" fit reuses `LB_RUN`.

### 2.5 Anti-stacking safeguards (all measured in the prototype)

1. Quality enters through a clamped factor `F(q) ∈ [0.3, 2.0]`; alignment is clipped to ±2 z; fit enters through channels that already tanh-cap.
2. A single concept per axis (run, pass, coverage): the player cannot stack zone *and* power.
3. Total fit is bounded by weights chosen so that a fully aligned, elite offence earns ≈ +2 points of margin over a style-blind one, against ≈ 3.9 for a +10 quarterback (PR #95): *elite talent still matters more than perfect fit*.
4. Centred on 32 reference rosters, so adding terms cannot inflate league-wide scoring.
5. A deliberately mixed roster pays a mild penalty (`−|s_RB − s_OL|/2`), never a catastrophe.

---

## 3. Part 3 — Schemes, coaching and counters

### 3.1 Team identity

An **identity** is a small, named bundle of concepts:

| Offence identity | Run concept | Pass concept |
|---|---|---|
| Outside Zone | zone | timing |
| Power Running | power | vertical *or* balanced (Play-action Power) |
| Vertical Passing | balanced | vertical |
| Quick Timing | zone | timing |
| Air Raid Spread | zone | vertical |
| Balanced | balanced | balanced |

| Defence identity | Coverage | Front |
|---|---|---|
| Aggressive Man | man | quick (4-3 attack) |
| Zone Shell | zone | stout (3-4 two-gap) |
| Multiple | balanced | balanced |

Identities map onto the six `OffScheme` and six `DefScheme` values that the staff layer already carries, so a coordinator's scheme **is** the identity. No new coaching role.

### 3.2 Reconnecting scheme fit (Phase 0 fix)

Replace the player-level `scheme_tags` overlap with **derived tags** computed from archetype + style axes (e.g. an elusive back on a mobile line carries `zone_run`), computed on read, never stored. This fixes F5 (rookies and generated players currently carry none), requires no data migration, and keeps `staff-fit.ts` semantics. D1 quantifies the harm of the status quo.

### 3.3 Coaching

* The coordinator's `rating` already adds a flat effect (`staff-shift.ts`). Under this design it additionally scales **execution** `exec = 1 + 0.4·clamp((rating−50)/40, −1, 1)` ∈ [0.6, 1.4] on the fit and counter terms of its unit. A 90-rated OC realises 40% more of an available fit than average; a 20-rated one realises 70% of it. Talent still determines the base; coaching determines how much fit is realised.
* HC `gameManagement/discipline/aggression` are unchanged.

### 3.4 Weekly game plan

* The plan screen starts from the identity; its dials may lean within one step of it (zone→zone-heavy, never zone→power).
* A **recommendation** is computed from the cheap style axes (own identity fit and the opponent's front/coverage style) and then checked with the existing 160-pair plan preview. It names the opponent's weakest unit and the one lean it expects to help, with the preview's uncertainty.
* Overriding the identity for a week is allowed but is shown as costing fit.

### 3.5 No universally dominant scheme

Design test (Experiment D2): for each concept, the payoff against stout/neutral/quick fronts must differ in sign or size; a league-wide "everyone runs zone" must not beat identity-matched play. Where the prototype fails that test the weights are wrong, not the concept.

---

## 4. Part 4 — Presentation (summary)

Detailed in [UI-PROPOSAL.md](UI-PROPOSAL.md). Core rules: one **Team Identity** card; every player carries **Fit chips** (Good fit / Mixed / Poor fit) with one-sentence reasons; every prospect carries **range bars** with a confidence badge; an **Advanced** toggle reveals the style axes and z-scores; postgame feedback shows *what the roster construction and plan contributed*, with ranges (so luck stays visible).

---

## 5. What the prototype is and is not

The synergy terms of §2 were implemented **only** in a throw-away patch (`harness/synergy-proto.patch`, applied in a scratch git worktree). It reuses the engine's own reference centring, caps and channels. It is a faithful model of the *shape* of the proposal and the correct tool for effect sizes; it is not the production implementation, its weights are calibrated to a target (aligned elite ≈ +2 margin) rather than fitted to NFL data, and every number labelled "prototype" in EXPERIMENTS.md is a prediction, not an engine result. The scouting model of §1 was implemented only in the harness of Experiment C.
