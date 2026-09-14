/**
 * Authored v0 coaching staffs for the 32 current teams.
 *
 * Ratings sit on a compressed ~40–66 scale so the aggregate effect stays subtle
 * (best-vs-worst full staff ≈ 3–4 pts/team-game). Head coach AND coordinator
 * names are the real 2026-season hires, cross-checked against Wikipedia's
 * "List of current NFL head coaches" and the matching offensive/defensive
 * coordinator lists — not from memory, given how much of both ranks turns
 * over every year.
 *
 * That check is the reason to keep doing it. The coordinator rows were
 * refreshed for 2026 and the head-coach rows were not, which left ten teams
 * on the previous year's coach and produced five people apparently holding
 * two jobs at once — Brian Daboll listed as both the Giants' head coach and
 * the Titans' OC, Mike McDaniel as both the Dolphins' head coach and the
 * Chargers' OC, and so on. In every case the *coordinator* entry was the
 * current one and the head-coach entry was a year stale.
 *
 * When a coach in this table moves, their ratings move with them (John
 * Harbaugh took his Baltimore numbers to the Giants). A first-time head coach
 * gets the league baseline — 56 / 50 / 0.15, the mean of this table — rather
 * than an invented personality they have not earned, which is the same rule
 * the coordinator notes below describe.
 *
 * Scheme + tendency numbers (`ocScheme`/`passBias`/`tempo`,
 * `dcScheme`/`blitzBias`) are **informed, not measured** — there's no public
 * per-coordinator play-calling dataset behind this the way player ratings
 * have nflverse stats behind them. Where a coordinator has a well-known
 * public reputation (a long track record, a distinctive scheme lineage), the
 * numbers reflect that reputation — e.g. Brian Flores (MIN DC) and Todd
 * Bowles (TB DC) are both known for unusually heavy, disguised blitz
 * packages, so both sit at the top of the blitzBias range; Gus Bradley
 * (TEN DC) is the prototypical low-blitz Seattle cover-3 disciple, so he
 * sits at the bottom. Many 2026 hires are first-time or little-known
 * coordinators with no real public track record to go on; those are left at
 * or near the league-mean baseline (`staff-market.ts` computes that mean
 * from this table) rather than an invented, unearned personality. **All of
 * this is v0 and meant to be tuned** — nothing here is a considered ranking.
 */

import type { DefScheme, OffScheme, Staff } from "./staff.js";

// [hcName, gameMgmt, discipline, aggression,
//  ocName, ocRating, ocScheme, passBias, tempo,
//  dcName, dcRating, dcScheme, blitzBias]
type Row = [
  string,
  number,
  number,
  number,
  string,
  number,
  OffScheme,
  number,
  number,
  string,
  number,
  DefScheme,
  number,
];

const TEAMS: Record<string, Row> = {
  // AFC East
  BUF: ["Joe Brady", 56, 50, 0.15, "Pete Carmichael Jr.", 62, "pro_style", 0.10, 0.10, "Jim Leonhard", 60, "multiple", 0.15],
  MIA: ["Jeff Hafley", 56, 50, 0.15, "Bobby Slowik", 60, "zone_run", 0.20, 0.30, "Sean Duggan", 50, "cover_2", 0.00],
  NE: ["Mike Vrabel", 58, 60, 0.00, "Josh McDaniels", 58, "pro_style", 0.00, 0.00, "Zak Kuhr", 50, "man_press", 0.10],
  NYJ: ["Aaron Glenn", 50, 48, 0.05, "Frank Reich", 52, "spread", 0.15, 0.15, "Brian Duker", 50, "man_press", 0.15],
  // AFC North
  BAL: ["Jesse Minter", 56, 50, 0.15, "Declan Doyle", 56, "power_run", -0.05, 0.05, "Anthony Weaver", 58, "multiple", 0.20],
  CIN: ["Zac Taylor", 52, 50, 0.10, "Dan Pitcher", 58, "vertical", 0.15, 0.10, "Al Golden", 48, "cover_3", 0.05],
  CLE: ["Todd Monken", 56, 50, 0.15, "Travis Switzer", 52, "zone_run", 0.00, 0.00, "Mike Rutenberg", 50, "four_three", 0.15],
  PIT: ["Mike McCarthy", 62, 52, 0.15, "Brian Angelichio", 52, "power_run", -0.05, -0.05, "Patrick Graham", 60, "multiple", 0.18],
  // AFC South
  HOU: ["DeMeco Ryans", 56, 54, 0.15, "Nick Caley", 54, "zone_run", 0.10, 0.10, "Matt Burke", 50, "four_three", 0.15],
  IND: ["Shane Steichen", 54, 50, 0.15, "Jim Bob Cooter", 54, "west_coast", 0.05, 0.05, "Lou Anarumo", 58, "cover_3", 0.18],
  JAX: ["Liam Coen", 50, 46, 0.15, "Grant Udinski", 50, "zone_run", 0.10, 0.10, "Anthony Campanile", 50, "cover_3", 0.10],
  TEN: ["Robert Saleh", 54, 52, 0.1, "Brian Daboll", 60, "spread", 0.20, 0.20, "Gus Bradley", 52, "cover_3", 0.00],
  // AFC West
  DEN: ["Sean Payton", 62, 50, 0.20, "Davis Webb", 56, "vertical", 0.15, 0.10, "Vance Joseph", 58, "man_press", 0.22],
  KC: ["Andy Reid", 66, 56, 0.25, "Eric Bieniemy", 64, "west_coast", 0.20, 0.10, "Steve Spagnuolo", 60, "man_press", 0.22],
  LV: ["Klint Kubiak", 56, 50, 0.15, "Andrew Janocko", 48, "zone_run", 0.00, 0.00, "Rob Leonard", 50, "cover_3", 0.05],
  LAC: ["Jim Harbaugh", 62, 58, 0.20, "Mike McDaniel", 62, "zone_run", 0.15, 0.30, "Chris O'Leary", 50, "multiple", 0.10],
  // NFC East
  DAL: ["Brian Schottenheimer", 48, 46, 0.10, "Klayton Adams", 52, "spread", 0.15, 0.10, "Christian Parker", 50, "multiple", 0.10],
  NYG: ["John Harbaugh", 64, 56, 0.4, "Matt Nagy", 56, "west_coast", 0.15, 0.10, "Dennard Wilson", 50, "cover_2", 0.10],
  PHI: ["Nick Sirianni", 56, 50, 0.20, "Sean Mannion", 50, "power_run", -0.05, 0.00, "Vic Fangio", 62, "multiple", 0.00],
  WAS: ["Dan Quinn", 56, 52, 0.20, "David Blough", 50, "spread", 0.10, 0.05, "Daronte Jones", 50, "cover_3", 0.10],
  // NFC North
  CHI: ["Ben Johnson", 54, 48, 0.20, "Press Taylor", 56, "spread", 0.20, 0.20, "Dennis Allen", 58, "four_three", 0.20],
  DET: ["Dan Campbell", 58, 44, 0.45, "Drew Petzing", 54, "spread", 0.15, 0.15, "Kelvin Sheppard", 50, "four_three", 0.15],
  GB: ["Matt LaFleur", 58, 54, 0.15, "Adam Stenavich", 58, "zone_run", 0.10, 0.05, "Jonathan Gannon", 54, "multiple", 0.08],
  MIN: ["Kevin O'Connell", 58, 52, 0.20, "Wes Phillips", 58, "west_coast", 0.15, 0.05, "Brian Flores", 60, "man_press", 0.45],
  // NFC South
  ATL: ["Kevin Stefanski", 56, 54, 0.1, "Tommy Rees", 52, "spread", 0.15, 0.15, "Jeff Ulbrich", 52, "four_three", 0.18],
  CAR: ["Dave Canales", 48, 46, 0.10, "Brad Idzik", 48, "west_coast", 0.10, 0.05, "Ejiro Evero", 48, "multiple", 0.05],
  NO: ["Kellen Moore", 50, 48, 0.15, "Doug Nussmeier", 54, "pro_style", 0.05, 0.05, "Brandon Staley", 50, "cover_3", 0.10],
  TB: ["Todd Bowles", 54, 50, 0.10, "Zac Robinson", 56, "west_coast", 0.15, 0.10, "Todd Bowles", 58, "man_press", 0.42],
  // NFC West
  ARI: ["Mike LaFleur", 56, 50, 0.15, "Nathaniel Hackett", 52, "pro_style", 0.10, 0.10, "Nick Rallis", 48, "multiple", 0.08],
  LA: ["Sean McVay", 64, 54, 0.25, "Nathan Scheelhaase", 60, "zone_run", 0.15, 0.10, "Chris Shula", 50, "multiple", 0.12],
  SF: ["Kyle Shanahan", 64, 52, 0.25, "Klay Kubiak", 62, "zone_run", 0.10, 0.10, "Raheem Morris", 56, "man_press", 0.18],
  SEA: ["Mike Macdonald", 54, 52, 0.10, "Brian Fleury", 50, "zone_run", 0.05, 0.05, "Aden Durde", 56, "multiple", 0.20],
};

function build(r: Row): Staff {
  const [hc, gm, disc, aggr, ocName, ocR, ocS, passB, tempo, dcName, dcR, dcS, blitzB] = r;
  return {
    headCoach: { name: hc, gameManagement: gm, discipline: disc, aggression: aggr },
    oc: { name: ocName, rating: ocR, scheme: ocS, passBias: passB, tempo },
    dc: { name: dcName, rating: dcR, scheme: dcS, blitzBias: blitzB },
  };
}

const STAFFS: Record<string, Staff> = Object.fromEntries(
  Object.entries(TEAMS).map(([t, r]) => [t, build(r)]),
);

/** The authored v0 staff for a team code, or `undefined` if unknown. */
export function teamStaff(team: string): Staff | undefined {
  return STAFFS[team];
}

/** All 32 authored staffs, keyed by team code. */
export function allStaffs(): Record<string, Staff> {
  return { ...STAFFS };
}
