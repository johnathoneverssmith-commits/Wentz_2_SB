export type PlayoffRound = "WC" | "DIV" | "CONF" | "SB";

export const ROUND_ORDER: PlayoffRound[] = ["WC", "DIV", "CONF", "SB"];
export const ROUND_LABEL: Record<PlayoffRound, string> = {
  WC: "Wild Card",
  DIV: "Divisional",
  CONF: "Conference Championship",
  SB: "Super Bowl",
};

export interface BracketMatchup {
  round: PlayoffRound;
  conference: "AFC" | "NFC" | "SB";
  highSeed: { code: string; seed: number } | null;
  lowSeed: { code: string; seed: number } | null;
  /** Favored team's win probability, 0–100. */
  favoredWinProb: number;
  homeScore: number | null;
  awayScore: number | null;
  winner: string | null;
}

export interface BracketState {
  currentRound: PlayoffRound;
  /** Seeds 1–7 per conference (team codes, index 0 = 1-seed). */
  seeds: { AFC: string[]; NFC: string[] };
  matchups: BracketMatchup[];
  champion: string | null;
  /**
   * `single`: one table, one bracket, no conferences — a humans-only league
   * (`state/singleBracket.ts`). Absent means the NFL's two-conference bracket.
   */
  format?: "single";
  /** The rounds this bracket plays, in order. Absent means `ROUND_ORDER`. */
  rounds?: PlayoffRound[];
  /** A single bracket's field, index 0 = 1-seed. */
  field?: string[];
  /**
   * The games the round just played, with their box scores, handed from the
   * simulator to the store in the same call as the bracket. Never stored:
   * the store moves them into `games` and drops this.
   */
  playedGames?: import("./game").GameResult[];
}

/** The rounds a bracket plays, in order. */
export function bracketRounds(b: Pick<BracketState, "rounds">): PlayoffRound[] {
  return b.rounds ?? ROUND_ORDER;
}

/** What a round is called in this bracket. A single bracket's `CONF` is its semifinal. */
export function roundLabelFor(b: Pick<BracketState, "format"> | null | undefined, round: PlayoffRound): string {
  if (b?.format === "single" && round === "CONF") return "Semifinal";
  // a humans-only league's championship isn't the Super Bowl
  if (b?.format === "single" && round === "SB") return "Final";
  return ROUND_LABEL[round];
}
