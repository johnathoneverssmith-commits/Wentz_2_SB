/**
 * Authored v0 coaching staffs for the 32 current teams.
 *
 * Ratings sit on a compressed ~40–66 scale so the aggregate effect stays subtle
 * (best-vs-worst full staff ≈ 3–4 pts/team-game). Schemes and tendency biases
 * roughly track each club's real identity. Head-coach names are the real ones;
 * coordinators are placeholders. **All of this is v0 and meant to be tuned /
 * edited in franchise mode** — nothing here is a considered ranking.
 */

import type { DefScheme, OffScheme, Staff } from "./staff.js";

// [hcName, gameMgmt, discipline, aggression,
//  ocRating, ocScheme, passBias, tempo,
//  dcRating, dcScheme, blitzBias]
type Row = [
  string,
  number,
  number,
  number,
  number,
  OffScheme,
  number,
  number,
  number,
  DefScheme,
  number,
];

const TEAMS: Record<string, Row> = {
  // AFC East
  BUF: ["Sean McDermott", 60, 58, 0.30, 62, "spread", 0.15, 0.20, 60, "multiple", 0.10],
  MIA: ["Mike McDaniel", 58, 46, 0.20, 60, "zone_run", 0.20, 0.35, 50, "cover_2", 0.00],
  NE: ["Mike Vrabel", 58, 60, 0.00, 46, "pro_style", -0.10, -0.05, 58, "man_press", 0.10],
  NYJ: ["Aaron Glenn", 50, 48, 0.05, 46, "west_coast", 0.00, 0.00, 60, "man_press", 0.15],
  // AFC North
  BAL: ["John Harbaugh", 64, 56, 0.40, 64, "power_run", -0.10, 0.05, 60, "multiple", 0.15],
  CIN: ["Zac Taylor", 52, 50, 0.10, 60, "west_coast", 0.20, 0.10, 48, "cover_3", 0.05],
  CLE: ["Kevin Stefanski", 56, 54, 0.10, 56, "zone_run", 0.00, 0.00, 62, "four_three", 0.20],
  PIT: ["Mike Tomlin", 60, 52, 0.05, 46, "pro_style", -0.05, -0.05, 62, "multiple", 0.15],
  // AFC South
  HOU: ["DeMeco Ryans", 56, 54, 0.15, 52, "west_coast", 0.10, 0.05, 60, "four_three", 0.20],
  IND: ["Shane Steichen", 54, 50, 0.15, 56, "spread", 0.05, 0.10, 48, "cover_2", 0.05],
  JAX: ["Liam Coen", 50, 46, 0.15, 54, "zone_run", 0.15, 0.10, 46, "cover_3", 0.05],
  TEN: ["Brian Callahan", 48, 48, 0.10, 48, "west_coast", 0.10, 0.05, 46, "three_four", 0.05],
  // AFC West
  KC: ["Andy Reid", 66, 56, 0.25, 66, "west_coast", 0.20, 0.05, 58, "four_three", 0.10],
  DEN: ["Sean Payton", 62, 50, 0.20, 60, "pro_style", 0.15, 0.05, 62, "man_press", 0.20],
  LAC: ["Jim Harbaugh", 62, 58, 0.20, 54, "power_run", -0.10, -0.05, 58, "multiple", 0.10],
  LV: ["Pete Carroll", 56, 46, 0.10, 48, "zone_run", 0.00, 0.00, 50, "cover_3", 0.05],
  // NFC East
  DAL: ["Brian Schottenheimer", 48, 46, 0.10, 52, "spread", 0.15, 0.05, 52, "multiple", 0.10],
  NYG: ["Brian Daboll", 52, 46, 0.15, 48, "west_coast", 0.10, 0.05, 52, "four_three", 0.15],
  PHI: ["Nick Sirianni", 56, 50, 0.20, 62, "pro_style", 0.05, 0.05, 60, "multiple", 0.15],
  WAS: ["Dan Quinn", 56, 52, 0.20, 56, "spread", 0.15, 0.10, 54, "four_three", 0.15],
  // NFC North
  CHI: ["Ben Johnson", 54, 48, 0.20, 60, "west_coast", 0.10, 0.10, 50, "cover_2", 0.05],
  DET: ["Dan Campbell", 58, 44, 0.45, 64, "pro_style", 0.05, 0.05, 52, "multiple", 0.15],
  GB: ["Matt LaFleur", 58, 54, 0.15, 60, "zone_run", 0.10, 0.05, 54, "four_three", 0.10],
  MIN: ["Kevin O'Connell", 58, 52, 0.20, 62, "west_coast", 0.15, 0.05, 58, "multiple", 0.20],
  // NFC South
  ATL: ["Raheem Morris", 52, 50, 0.10, 54, "zone_run", 0.05, 0.05, 48, "cover_3", 0.05],
  CAR: ["Dave Canales", 48, 46, 0.10, 50, "west_coast", 0.10, 0.05, 44, "three_four", 0.05],
  NO: ["Kellen Moore", 50, 48, 0.15, 54, "spread", 0.20, 0.10, 48, "cover_2", 0.05],
  TB: ["Todd Bowles", 54, 50, 0.10, 56, "vertical", 0.20, 0.05, 58, "man_press", 0.25],
  // NFC West
  ARI: ["Jonathan Gannon", 50, 50, 0.10, 52, "spread", 0.10, 0.10, 52, "multiple", 0.15],
  LA: ["Sean McVay", 64, 54, 0.25, 64, "west_coast", 0.15, 0.10, 56, "multiple", 0.15],
  SEA: ["Mike Macdonald", 54, 52, 0.10, 52, "zone_run", 0.05, 0.05, 62, "multiple", 0.20],
  SF: ["Kyle Shanahan", 64, 52, 0.25, 66, "zone_run", 0.05, 0.10, 58, "four_three", 0.10],
};

function build(team: string, r: Row): Staff {
  const [hc, gm, disc, aggr, ocR, ocS, passB, tempo, dcR, dcS, blitzB] = r;
  return {
    headCoach: { name: hc, gameManagement: gm, discipline: disc, aggression: aggr },
    oc: { name: `${team} OC`, rating: ocR, scheme: ocS, passBias: passB, tempo },
    dc: { name: `${team} DC`, rating: dcR, scheme: dcS, blitzBias: blitzB },
  };
}

const STAFFS: Record<string, Staff> = Object.fromEntries(
  Object.entries(TEAMS).map(([t, r]) => [t, build(t, r)]),
);

/** The authored v0 staff for a team code, or `undefined` if unknown. */
export function teamStaff(team: string): Staff | undefined {
  return STAFFS[team];
}

/** All 32 authored staffs, keyed by team code. */
export function allStaffs(): Record<string, Staff> {
  return { ...STAFFS };
}
