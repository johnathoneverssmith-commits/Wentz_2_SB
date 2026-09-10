# V1.6 — the points gap: diagnosis and plan

Status: **steps 1–4 done + the mechanical bugs fixed. Residual is a smaller,
diffuse drive-conversion + fewer-drives gap — see "Step-4 results" below.**
Tools: `analysis/29_drive_baseline.py` (empirical), `analysis/lib_py/drives.py`
(shared summariser), drive metrics in `analysis/23_full_sim_validation.py`.

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

---

## Step-4 results (2026-09-09) — the hypothesis was right; two mechanical bugs

Instrumented `engine/sim.py` with a per-drive log and compared to the empirical
baseline through `lib_py.drives.drive_table` (the one shared summariser). Two
straight bugs in the punt path in `_fourth_down`:

1. **Touchback:** `self._flip_field(1 - 20)` → `clip(-19, 1, 99)` = **1**, i.e.
   the receiving team started at the *opponent's* 1-yard line after every punt
   touchback. Fixed to `_flip_field(80.0)` (own 20).
2. **Return sign:** `self._flip_field(100 - landing + ret)` — a punt return
   *added* `ret` to the receiving team's `yardline_100`, moving them **backward**
   ~10 yд on every returned punt. Fixed to `100 - landing - ret`.

Effect (n=200, rating layer off), before → after:

| | before | after | empirical |
| --- | ---: | ---: | ---: |
| points / drive | 1.81 (−6.8%) | **1.86 (−4.2%)** | 1.942 |
| start_yl mean | 71.9 | **71.1** | 70.1 |
| start_yl p10 | 56 | **54** | 50 |
| drive start "opp 0–9" share | 2.5% | **0.4%** | 0.5% |
| drive start "own 90–99" share | 14.5% | **10.3%** | 8.2% |
| TD-drive share | 19.9% | **20.4%** | 22.2% |
| punt-drive share | 38.6% | **36.5%** | 35.2% |
| `never crossed midfield` | 44.4% | 43.8% | 42.8% |
| points / **team-game** | 19.6 (−13.1%) | **19.9 (−11.8%)** | 22.56 |

Field position is now close. `never crossed midfield` confirms §2 — the old
"37% v 18%" was a measurement bug, the engine matches. Bugs mirrored to
`src/engine/sim.ts`.

### What's left (the −11.8% team-game gap decomposes as)

- **≈ −4% drive conversion, and it is NOT uniform — it lives entirely in
  long-field drives.** Added `first_downs` to the per-drive record and split
  every metric by starting field-position band:

  | start band (own yds to goal) | share | FD/drive sim / emp | plays/drive sim / emp | pts/drive sim / emp |
  | --- | ---: | ---: | ---: | ---: |
  | ≤ opp 49 (bands 0–49) | 12% | ≥ emp | ≈ emp | ≈ emp |
  | own 40–49 (band 50–59) | 6% | 1.68 / 1.64 | 6.24 / 6.27 | 2.52 / 2.49 |
  | own 31–40 (band 60–69) | 18% | 1.79 / 1.83 | 6.71 / 6.78 | 2.07 / 2.17 |
  | **own 21–30 (band 70–79)** | **46%** | **1.70 / 1.89** | **6.58 / 7.00** | 1.79 / 1.79 |
  | **own 11–20 (band 80–89)** | **15%** | **1.70 / 1.90** | **6.75 / 7.17** | **1.27 / 1.44** |
  | **own 1–10 (band 90–99)** | **8%** | **1.66 / 1.93** | **6.57 / 7.21** | **1.04 / 1.17** |

  Drives that start past midfield convert fine. Drives that start at the own 30
  or deeper — **69% of all drives** — run ~5–9% fewer plays and convert
  **~10–14% fewer first downs**. Globally: FD/drive 1.69 v 1.79 (−5.6%),
  plays/drive 6.63 v 6.75, 3-and-out 26.5% v 25.7% (both fine). So the engine's
  *opening* set of downs from deep is fine (3-and-out rate matches) but the
  drives that DO get moving stall around midfield instead of pushing into
  scoring range — they get 1–2 first downs and punt, where real long-field
  drives get 2–3 and reach FG/TD range.

  §1 rules out momentum (ρ≈0). Next probe — restricted to drives starting ≥ own
  30: the **down/distance state mix** deeper in the drive (2nd/3rd-and-long
  share), **M02 play-call mix by field position**, and **M14 rush yards in the
  `fp="own"` bucket** vs empirical. One of those conditionals is skewing
  long-field drives short.
- **≈ −3% fewer drives/team-game** (10.31 v 10.75) — the clock runs hot
  (plays/team-game +7%), so drives are longer and more get caught by the half
  (`end_of_half` 9.3% v 6.85%). Raising the drive-end clock multiplier was tried
  before and made points *worse*; needs the per-play elapsed model (M24), a
  separate item.
- **≈ 1pp too few `opp_touchdown` drives** (0.12% v 1.11%) — return-TD rate off
  turnovers is ~10× low; near points-neutral leaguewide but part of the 22.56.

### Next

1. Long-field-drive probe (above): down-state mix, M02 by FP, M14 `fp="own"`.
2. Fix whichever conditional is skewing long-field drives short.
3. Clock / drives-per-game (M24) and return-TD rate are separate items.
