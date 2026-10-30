# League DNA: the era catalogue, its sources and its limits

A League Profile says "this fictional league resembles the NFL of year X". It is a **qualitative analogy chosen after
the players exist**. It is not a rule set, not a claim about historical player ratings (there are no public ratings
to compare against), and it changes nothing about how the league plays.

## How a match is made

1. The league's players are generated from its seed (`ui-source/src/sim/leagueDna/`). Nothing about an era is an input.
2. The pool is read on four axes (`profile.ts`): **passing** (QB, receivers, pass blocking), **ground** (RB, line, a
   nudge from mobile quarterbacks), **front** (EDGE, DT, ILB) and **coverage** (CB, S). Each is how far the
   starter-level talent sits above or below a league with no character, in rating-point units.
3. The nearest of five eras (`eras.ts`) is chosen by distance on those axes. If the nearest is farther than
   `MATCH_CUTOFF` the league gets a **fictional-era** title instead ("Ground-and-Pound Era (fictional)"). About half of
   leagues match an era and each era is reachable (checked by sampling 300 leagues when the constants were set).

## The catalogue and what each placement leans on

| Era | Placement (passing / ground / front / coverage) | Public record it leans on |
|---|---|---|
| 2000 | -0.5 / +0.5 / +0.3 / +0.2 | League scoring ~20.7 points per team-game in 2000 ([nfldata.org era dashboard](https://nfldata.org/era_dashboard.php)), the low end of the modern range. |
| 2011 | +0.9 / -0.3 / 0 / -0.4 | Three 5,000-yard passers in 2011 (Brees 5,476; Brady 5,235; Stafford 5,038), and scoring rising from ~22.0 in 2010 ([Pro Football Reference passing leaders](https://www.pro-football-reference.com/leaders/pass_yds_single_season_2011.htm); [NFL Operations on scoring](https://operations.nfl.com/gameday/analytics/stats-articles/where-have-all-of-the-nfl-points-gone)). |
| 2013 | +0.7 / +0.2 / +0.2 / -0.2 | 2013 set the then-record scoring average (~23.4) and Peyton Manning's 5,477 passing yards. |
| 2020 | +0.5 / +0.4 / -0.1 / -0.3 | 2020 averaged ~24.8 points per team-game, the highest of the period. |
| 2024 | -0.1 / +0.2 / +0.5 / +0.4 | 2024 had the fewest combined pass attempts per game since 2008; scoring had fallen for several years running. |

## Limits, stated plainly

* **The numbers in the table are placements, not measurements.** They were set by the maintainers from the public
  record above plus general football history. Pro Football Reference was not reachable from the build environment, so
  per-season rush/pass splits, sack rates and passer ratings were **not** fitted; the sources above are the ones that
  could be read. A numeric version (league pass rate, rush yards per attempt, sack rate, scoring, by season) would be
  a better foundation and is the first thing to replace if the catalogue is revisited.
* **An illustrative mapping in the brief did not survive the check.** 2013 is a *peak-scoring* season, not a
  defence-led one, so it is catalogued as a high-scoring era; the defence-and-ground-game placement went to 2000 and
  the 2024 era.
* Only broad tendencies are ever shown ("deep", "thin"); never counts, ratings or potential, and never advice on how
  to draft.
* Future draft classes get their own scouting report from their own distribution (`classProfile.ts`), with no era label.
