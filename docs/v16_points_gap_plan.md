# V1.6 — the points gap: diagnosis and plan

Status: **diagnostic pass done, implementation not started.**
Companion probe: `analysis/_v16_probe.py` (scratch; promote to a numbered script).

The engine scores ~19.9 pts/team-game against an empirical 22.6 (−11.9%). Prior
work (`docs/decisions.md`, "Diffuse points gap") concluded the gap was emergent
from compounding 2–7% misses with no single lever, and that a fix would need
"drive-level EPA modelling". This pass tested that framing. Two findings change
it materially.

---

## 1. Within-drive persistence is NOT the mechanism (hypothesis refuted)

The most attractive explanation for "every per-play marginal is correct but
drives under-produce" is that the engine samples plays **independently** given
state, while real football has drive-level momentum. Independent draws with
correct marginals systematically under-produce the tail of *cumulative*
outcomes, which would explain low first-downs/drive, high plays/series, more
3-and-outs and fewer points — all at once.

Tested directly on 2023–25 pbp (98,194 plays, 16,942 drives): residual =
success − P(success | down, distance, field-position band), grouped by drive.

| drives with ≥ n plays | mean n | observed / independent variance | implied intra-drive ρ |
| --- | ---: | ---: | ---: |
| ≥3 | 6.13 | 1.216 | +0.042 |
| ≥4 | 7.44 | 0.946 | −0.008 |
| ≥5 | 7.99 | 0.931 | −0.010 |

Lag-1 residual correlation: **+0.031**. Mean residual after a successful play
+0.009 vs after a failure −0.024 (gap 0.033 on a 0.445 base).

The ≥3 row's apparent overdispersion is a length-selection artifact — drive
length is endogenous to success, so including 3-play drives (all-failure
3-and-outs) inflates the variance of drive means. The clean ≥4 / ≥5 rows say
**ρ ≈ 0**. Real plays are, to a very good approximation, conditionally
independent given state.

**Consequence: do not build a drive-level latent-efficiency / momentum layer.**
It would be modelling something that isn't there.

---

## 2. The diagnostic baseline itself is wrong (measurement bug)

`docs/decisions.md` records "**drives that never cross midfield are 37% v 18%**"
as the headline discrepancy. Measured directly from 2023–25 pbp:

> **never crossed midfield = 42.76%**

The engine's 37% is *better* than empirical, not 2× worse. The prior comparison
was between inconsistent definitions. Related: empirical plays/drive is **6.75**
(all plays) or **5.80** (run/pass only) depending on definition, and
plays/series is **2.632** — the prior note has empirical 5.69 and the engine
"grinding" at 6.27 plays/drive, which under the all-plays definition is *low*,
not high.

This is the fourth measurement-definition bug in this engine's history (3rd-down
conversion, RZ TD rate, the §23 hash seed, now this). **The prior "no single
lever, compounding 2–7% misses" conclusion rests on at least one badly wrong
number and should not be treated as settled.**

---

## 3. Where the points actually are

Empirical drive table, 2023–25 (18,387 drives, 10.75/team-game):

| outcome | share |
| --- | ---: |
| Punt | 35.20% |
| Touchdown | 22.15% |
| Field goal | 15.82% |
| Turnover | 10.03% |
| End of half | 6.85% |
| Turnover on downs | 5.87% |
| Missed field goal | 2.71% |
| Opp touchdown | 1.11% |
| Safety | 0.26% |

Offensive **points/drive = 1.94**; × 10.75 drives = 20.87 pts/team-game. The
remaining ~1.7 of the 22.56 empirical total is non-drive scoring (defensive and
return TDs, XP/2-pt accounting). So the offensive-drive gap is **smaller than
−11.9%** — a chunk of the headline gap lives in scoring the engine may already
model but that §22 attributes differently.

**Points/drive by starting field position** — the curve the engine must reproduce:

| start (own yds to goal) | share of drives | pts/drive | TD% |
| --- | ---: | ---: | ---: |
| 0–9 (opp 9 in) | 0.5% | **5.60** | 72.9% |
| 10–19 | 1.0% | 4.29 | 48.1% |
| 20–29 | 1.6% | 4.23 | 45.7% |
| 30–39 | 2.5% | 3.21 | 32.8% |
| 40–49 | 4.1% | 2.46 | 25.2% |
| 50–59 | 6.7% | 2.49 | 27.0% |
| 60–69 | 17.6% | 2.17 | 24.7% |
| 70–79 | 41.5% | 1.79 | 20.6% |
| 80–89 | 16.4% | 1.44 | 17.0% |
| 90–99 | 8.1% | 1.17 | 15.4% |

Start FP: mean 70.14, median 72, p10 **50**, p25 65, p75 79, p90 88.

**The 9.7% of drives that start in opponent territory (≤49) carry ~16.5% of all
offensive points.** A drive starting at the opponent 45 is worth 2.46 pts; one
starting at your own 25 is worth 1.79. Under-producing short fields costs points
fast *while every per-play metric stays correct* — which is precisely the
observed signature.

---

## 4. The hypothesis to test next

**The engine under-produces opponent-territory drive starts.** Nothing in §22
measures drive start field position, and `engine/sim.py` records no
`drive_start_yardline` stat at all — this has never been checked.

Specific suspects in `analysis/engine/sim.py`:

- **Fumble recoveries return 0 yards.** `_turnover(spot=...)` is called with no
  `return_yards` on a lost fumble, and the spot is the ball-carrier's position —
  no return at all.
- **INT returns average 6 yards** (`rng.normal(6, 8)`); check against the
  empirical INT-return distribution, which has a long tail.
- **Missed FG spot** — verify the defense takes over at the correct spot (the
  snap, not the line of scrimmage).
- **Punt net / return** — `sample_punt_return` and the touchback/downed mix.
- **Kickoff spot**: touchback → own 30 (`yardline_100 = 70.0`), return →
  `25 + N(3,6)` ≈ own 28. Sane, but confirm against 2023–25, which spans the
  2024 dynamic-kickoff rule change.
- **`End of half` is 6.85% of empirical drives** and the engine has no such
  outcome (noted in the prior diagnostic and still true).

---

## 5. Build plan (implementation — hand to Sonnet)

1. **Instrument the engine.** Add per-drive records to `engine/sim.py`:
   `drive_start_yardline`, `drive_result` (TD/FG/punt/downs/turnover/missed
   FG/end-of-half/safety), plays, and whether it crossed midfield. Mirror in
   `src/engine/sim.ts`.
2. **Promote `analysis/_v16_probe.py`** to a numbered script that emits the
   empirical drive baseline to `artifacts/validation/drive_baseline.json`
   (outcome mix, start-FP distribution, pts/drive by FP band, series stats).
3. **Add drive metrics to §22** (`23_full_sim_validation.py`) on *identical*
   definitions to the empirical side — this is where the prior bugs came from,
   so build one shared helper and have both sides call it.
4. **Compare the two curves.** Decisive split:
   - start-FP distribution shifted back, pts/drive-by-FP curve overlays →
     **field-position bug** (fix turnovers/returns/kickoffs; likely cheap).
   - start-FP matches, pts/drive-by-FP curve sits below at every band →
     **drive conversion** (then, and only then, consider drive-level modelling).
   - curves match near the goal line, diverge mid-field → look at 4th-down
     policy (M01) and FG-attempt range.
5. **Add the `End of half` drive outcome** (6.85% of drives) regardless — the
   engine forcing every drive to a real result is a known structural gap.

Do **not** start with a drive-level EPA model. §1 says the per-play independence
assumption is sound, and §3–4 say there is a cheaper, more likely explanation
that has never been measured.
