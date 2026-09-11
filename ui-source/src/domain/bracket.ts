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
}
