# Agent 02 — Simulation Realism report

**Baseline:** `3abcfff0f58d7117bbcd265f9cea9e7f1bcc829b` (master after PR #87). No gameplay, rating, pool, scoring, development or injury code was modified. The branch adds only this folder. The harnesses live in `harness/`; to run one, copy it to `online/test/_agent02_*.test.ts` (underscore-named, excluded from CI) and delete the copy afterwards. No copies are committed.
Backlog with evidence, repro and acceptance criteria: **[TAFI_BACKLOG.md](TAFI_BACKLOG.md)** (TAFI-REAL-001…017).

## Bottom line
**How realistic is Wentz 2 SB today?** At the league level, quite: points per team-game 22.0 vs 22.4 (NFL 2021-24), penalties 5.9 vs 5.9, field-goal accuracy 84-85% vs 84.5%, fourth-down behaviour, aging curves and retirement are all in range; every score decomposes into recorded scoring events; there are no dynasties and rebuilding teams recover. It is **less realistic in the composition of offense** (too many rushing touchdowns, too few passing touchdowns, quarterback rating barely moves yards per throw), in some **rules and rare events** (safeties, overtime walk-offs, never a two-point try), and in **talent dynamics** (a start-up transient and slow erosion of the elite tail).

**Most important shortcomings, in priority order**
1. **TAFI-REAL-006** TD mix / RB workload: pass TD 1.10–1.16 vs 1.45, rush TD 1.19–1.26 vs 0.91; 300-carry backs 6/season vs 2.3; RB rushing TDs up to 33 (NFL 16–18); no 40-TD QB in 60 seasons (NFL: 10 in 7).
2. **TAFI-REAL-007** QB overall ↔ yards per attempt correlation 0.02–0.10; elite vs <65 QBs differ only in INT%.
3. **TAFI-REAL-008** turnovers 0.90–0.97 per team-game vs 1.29.
4. **TAFI-REAL-001 / 002 / 003** safeties 1.2–2.7× the NFL rate, overtime defensive scores don't end the game, two-point tries never happen.
5. **TAFI-REAL-009** talent start-up transient and elite-tail decay (90+ players halve after year 6).

**Improvements that add the most realism with the least cost to fun:** (a) re-fit the run/pass/TD split on steady-state franchise leagues (fixes 1 and 3 together); (b) give the QB a yards-per-throw and TD effect so QB trades matter the way fans expect; (c) three small rules fixes (2-pt chart for CPU, OT walk-off, shadow-zone safety rate); (d) set the talent-supply target at equilibrium.

## Scope actually completed (read this before relying on any claim)
| Requirement | Status |
|---|---|
| ≥20-season accelerated simulation | **Done**: 3 leagues × 20 seasons = 60 seasons, real engine games, `online` phase machine (seeds 7001, 7002 Amplified; 7003 Realistic). |
| ≥5 consecutive interactive UI seasons | **Not met: only ONE interactive UI season (season 1) was completed**; the run stopped in season 2 at week 16. See "UI playthrough status" below. |
| Game-level forensics | Done: 4 × traced samples (28,000+ games). |
| Player development/aging, injuries | Done from the same data; injury benchmarks not sourced (see TAFI-REAL-016). |
| Historical benchmarks | nflverse 2021-24 regular season (1,087 games, pbp, player stats 2018-24), downloaded 2026-11-07; scripts `analysis/bench_nfl*.py`. |

## Method
- **Accelerated runs** — `harness/agent02_longrun.test.ts`: `createLeague(seed, {…DEFAULT_CONFIG, humanGmCount:1, talentImpact})`, fantasy draft completed instantly, then every stage through `readyUpLocal` / `advanceStage`, with the human GM (KC) on the server's own autopilot for turn stages. Every game is played by `simulateBlock` (`online/src/blocks.ts`, the real engine with injuries, weather, staff, plans). Per season it records team totals for all games, injuries, player season stats, bracket and champion; player snapshots at every preseason and post-playoffs. Data: `data/raw/run_*.jsonl.gz`, summaries `data/summary_{A1,A2,R1}.json`, `data/aging_*.json`, `data/injuries.json`.
- **Caveat on season 1 of these runs:** the harness starts at preseason directly after the fantasy draft, skipping the training-camp step the real flow performs, so season 1 (labelled 2026) is a burn-in (19 ppg, 1.44 turnovers, starter means ~61) and **is excluded from every "steady-state" number** (`data/steady_state_means.json`). The interactive UI run supplies true first seasons.
- **Forensics** — `harness/agent02_forensics.test.ts`: traced games with random home/away pairings (not a schedule), scoring events summed and compared to the final score; drives, fourth-down calls; optional `A02_WARM` seasons of warm-up.
- **Statistics:** 60 league-seasons give a standard error of 0.004 on home win% over 16,320 games; league means over 19 seasons with per-season slope ± SE are in `data/summary_*.json`. Differences quoted as "significant" are > 2.5 SE; the NFL side is only four seasons (1,087 games), so NFL year-to-year persistence (r = 0.31) is itself uncertain.
- **Not done / limits:** no weather-effect isolation; no stats on CPU trade/FA realism (Agent 7's area); injury benchmarks absent; one engine version; human GM behaviour is autopilot in the accelerated runs; the forensic pairings are random not scheduled.

## League-wide comparison (seasons 2–20, three runs)
| Metric | A1 (Amp, 7001) | A2 (Amp, 7002) | R1 (Real, 7003) | NFL 2021-24 |
|---|---|---|---|---|
| Points / team-game | 22.07 | 21.98 | 21.98 | 22.39 |
| Points sd (team-game) | 9.13 | 9.15 | 8.85 | 9.89 |
| Margin sd | 13.35 | 13.30 | 12.70 | 14.20 |
| Home win % | 0.511 | 0.513 | 0.501 | 0.541 |
| Total yards / team-game | 349 | 349 | 347 | – |
| Plays / team-game (sim definition) | 57.5 | 57.2 | 57.5 | pass+rush att 63.1 |
| Turnovers / team-game | 0.94 | 0.90 | 0.97 | 1.29 |
| Sacks allowed | 2.26 | 2.21 | 2.24 | 2.42 |
| Penalties / yards | 5.90 / 51.1 | 5.85 / 50.4 | 5.88 / 50.6 | 5.91 / 49.0 |
| OT rate | 5.5% | 5.0% | 5.5% | 6.3% |
| Wins sd (all 20 seasons) | 2.68 | 2.79 | 2.31 | 3.10 |
| Champions / 20 yr | 13 | 17 | 14 | – |
Time trend (A1/A2/R1 slopes per season): points +0.05/+0.10/+0.12, rush yards +1.1/+1.0/+1.2, pass yards −0.8/−0.2/−0.2 (all seasons incl. burn-in); excluding season 1 the league is flat (see `data/summary_*.json` series).

## Scoring and game anomaly register (summary)
| Item | Result |
|---|---|
| Score ≠ Σ recorded scoring events | 0 of 12,000 games |
| Impossible scores (1, 4) | none in 16,320 + 12,000 games |
| Safeties | 0.06–0.13 / game vs 0.049 — TAFI-REAL-001 |
| Two-point conversions | none — TAFI-REAL-003 |
| OT walk-off errors | 3 of 9 sampled OT oddities — TAFI-REAL-002 |
| Extreme scores | max 59–70 points, total max 100 (random pairings, year-1) — below 1 in 10,000 |
| Shutouts | 0.6–0.9% vs 1.0% |
| Margin ≥ 21 | 12.5–18.9% (warm/year-1 mix) vs 16.6% — OK (Amplified year-1 27.5% only before warm-up) |
| Fourth-down | in line (TAFI backlog §C) |

## Player development and aging (summary, `data/aging_*.json`)
Plausible shape: mean rating change +2.1 (21) → ~0 (27) → −1.9 (32); integrated peaks QB 29–30, RB 25, WR/TE 27, OL 28–29, DL 27–28; RB 30+ retire 55–57%/yr; high-rated players rarely retire early. Concerns: nearly deterministic careers (TAFI-REAL-015), elite-tail decay and talent transient (TAFI-REAL-009), higher-than-real QB ratings (mean starter 83–85).

## Injuries (summary)
~0.5 events per team-game, 63% minor; per-player exposure lowest for QB (12/100 seasons) and RB (19/100) — inverted vs football expectation (TAFI-REAL-016). No benchmark loaded; "injured players playing" was not verified from this data.

## Reproduce
```bash
npm ci && npm --prefix ui-source ci
cp docs/qa-longitudinal/agent-02-realism/harness/agent02_longrun.test.ts online/test/_agent02_longrun.test.ts
A02=1 A02_SEED=7001 A02_SEASONS=20 A02_TALENT=amplified A02_OUT=/tmp/run.jsonl npx vitest run --root online test/_agent02_longrun.test.ts   # ~10 min
PYTHONPATH=analysis python3 analysis/analyze_longrun.py /tmp/run.jsonl A1 && PYTHONPATH=analysis python3 analysis/analyze_aging.py /tmp/run.jsonl A1
# NFL benchmarks: download nflverse files named in analysis/bench_nfl.py to /tmp/nflv, then
OUT=data/nfl_benchmarks.json python3 analysis/bench_nfl.py && python3 analysis/bench_nfl2.py
```

## UI playthrough status (as of this commit)
Only season 1 (Bengals, champion DEN) was captured through the real UI + engine adapter (`data/raw/ui_season1_bengals.jsonl.gz`, click log `data/ui_actions.jsonl`); the run was in season 2 when stopped. Five seasons were **not** completed. Driver: `harness/ui_playthrough.cjs` (accepts confirm dialogs; staff-assisted FA, deadline and roster fixes).
