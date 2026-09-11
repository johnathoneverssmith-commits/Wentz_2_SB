import type { Position } from "./player.ts";
import type { GameBroadcast } from "./broadcast.ts";

export interface PlayerGameLine {
  playerId: string;
  name: string;
  position: Position;
  passCmp?: number;
  passAtt?: number;
  passYds?: number;
  passTd?: number;
  passInt?: number;
  rushAtt?: number;
  rushYds?: number;
  rushTd?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  tackles?: number;
  sacks?: number;
  defInt?: number;
  passDef?: number;
  fgm?: number;
  fga?: number;
  xpm?: number;
  xpa?: number;
}

export interface TeamGameTotals {
  points: number;
  totalYards: number;
  passYards: number;
  rushYards: number;
  plays: number;
  thirdDownMade: number;
  thirdDownAtt: number;
  topSeconds: number;
  penalties: number;
  penaltyYards: number;
  turnovers: number;
  /** points per quarter, index 0 = Q1; extra entries = OT. */
  byQuarter: number[];
}

export interface ScoringPlay {
  quarter: number;
  team: string;
  description: string;
  /** running score "home-away" after the play, from the home team's view. */
  homeScore: number;
  awayScore: number;
}

export interface GameResult {
  id: string;
  week: number;
  /** "PRE" weeks 1-3, "REG" weeks 1-18, or a playoff round label. */
  phase: "PRE" | "REG" | "WC" | "DIV" | "CONF" | "SB";
  homeTeam: string;
  awayTeam: string;
  played: boolean;
  homeScore: number;
  awayScore: number;
  totals?: { home: TeamGameTotals; away: TeamGameTotals };
  scoringPlays?: ScoringPlay[];
  playerLines?: { home: PlayerGameLine[]; away: PlayerGameLine[] };
  /** full play-by-play + injuries, engine-backed — populated for the viewer's game only. */
  broadcast?: GameBroadcast;
}

export interface ScheduledGame {
  week: number;
  phase: "PRE" | "REG";
  homeTeam: string;
  awayTeam: string;
}
