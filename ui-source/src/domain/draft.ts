import type { Position } from "./player.ts";

export interface DraftProspect {
  id: string;
  name: string;
  position: Position;
  school: string;
  age: number;
  heightIn: number;
  weightLb: number;
  fortyTime: number | null;
  classYear: "Freshman" | "Sophomore" | "Junior" | "Senior";
  /** AI-generated college overall (spec §6.5). */
  collegeOverall: number;
  /** Projected draft round (1–7). */
  projectedRound: number;
  /** Fine-grained projection, e.g. "Top 10", "Late Round 1", "Early Round 2". */
  projectedRange: string;
  /** Ambiguously-toned scouting note — never plainly "good" or "bad". */
  scoutingNote: string;
  /** True overall, hidden in Draft Room / Preview, revealed at Rookie Signings. */
  trueOverall: number;
}

export type DraftMode = "fantasy" | "rookie";

/** overall pick number (1-based) → fine-grained projection label. */
export function projectionLabel(overallPick: number): string {
  if (overallPick <= 10) return "Top 10";
  if (overallPick <= 20) return "Mid Round 1";
  if (overallPick <= 32) return "Late Round 1";
  const round = Math.ceil(overallPick / 32);
  const withinRound = ((overallPick - 1) % 32) + 1;
  const half = withinRound <= 16 ? "Early" : "Late";
  if (round <= 3) return `${half} Round ${round}`;
  return `Round ${round}`;
}

/** Minimum roster count the "Team Needs" view checks per position group. */
export const POSITION_MINIMUMS: Record<string, number> = {
  QB: 2, RB: 3, WR: 5, TE: 2, OL: 8, DL: 4, EDGE: 4, LB: 4, CB: 4, S: 3, K: 1, P: 1,
};

export interface DraftPickResult {
  pickNumber: number;
  round: number;
  teamCode: string;
  /** Prospect id (rookie draft) or pool player id (fantasy draft). */
  selectedId: string | null;
  selectedName: string | null;
  selectedPosition: Position | null;
}

export interface DraftPickAsset {
  /** Season the pick is used in. */
  year: number;
  round: number;
  /** Team that currently owns the pick. */
  ownedBy: string;
  /** Team the pick originally belonged to (for "via trade w/ X"). */
  originalTeam: string;
}

export interface DraftState {
  mode: DraftMode;
  year: number;
  order: "snake" | "linear";
  /** Full pick order as team codes, already expanded across all rounds. */
  pickOrder: string[];
  currentPickIndex: number;
  results: DraftPickResult[];
  /** Prospect/player ids marked as targets, keyed by human GM id (private). */
  targetsByGm: Record<string, string[]>;
}
