/**
 * Plain-text season report (Phase A1).
 *
 * Turns an `NflSeasonResult` into a monospace standings + bracket printout —
 * the stand-in "UI" until the franchise layer lands, and the shape any later
 * renderer will want.
 */

import { DIVISION_IDS, divisionsIn } from "./nfl-structure.js";
import type { PlayoffGame } from "./playoffs.js";
import type { NflSeasonResult } from "./season.js";
import type { StandingRow } from "./standings.js";

function rec(w: number, l: number, t: number): string {
  return t > 0 ? `${w}-${l}-${t}` : `${w}-${l}`;
}

function standingsBlock(rows: StandingRow[]): string {
  const lines: string[] = [];
  for (const conf of ["AFC", "NFC"] as const) {
    lines.push("", `=== ${conf} ===`);
    for (const div of divisionsIn(conf)) {
      lines.push("", div);
      const members = rows
        .filter((r) => r.division === div)
        .sort((a, b) => a.divisionRank - b.divisionRank);
      for (const r of members) {
        const seed = r.seed ? `(${r.seed})` : "   ";
        const flag = r.wonDivision ? "z" : r.madePlayoffs ? "x" : " ";
        lines.push(
          `  ${flag}${seed} ${r.team.padEnd(4)} ${rec(r.wins, r.losses, r.ties).padEnd(7)}` +
            ` PF ${String(r.pointsFor).padStart(3)} PA ${String(r.pointsAgainst).padStart(3)}` +
            ` ${(r.pointDiff >= 0 ? "+" : "") + r.pointDiff}`.padEnd(7) +
            ` div ${r.divisionRecord.padEnd(7)} conf ${r.conferenceRecord}`,
        );
      }
    }
  }
  lines.push("", "  z = division winner, x = wild card");
  return lines.join("\n");
}

function bracketBlock(games: PlayoffGame[], champion: string): string {
  const lines: string[] = ["", "=== PLAYOFFS ==="];
  const label: Record<PlayoffGame["round"], string> = {
    wildcard: "Wild Card",
    divisional: "Divisional",
    conference: "Conf Champ",
    superbowl: "Super Bowl",
  };
  let round: string | null = null;
  for (const g of games) {
    if (label[g.round] !== round) {
      round = label[g.round];
      lines.push("", round);
    }
    const conf = g.conference === "NFL" ? "" : `${g.conference} `;
    const forced = g.decidedBySeed ? "  (decided by seed)" : "";
    lines.push(
      `  ${conf}(${g.homeSeed}) ${g.home.padEnd(4)} ${String(g.homeScore).padStart(2)}` +
        ` - ${String(g.awayScore).padStart(2)} ${g.away.padEnd(4)} (${g.awaySeed})` +
        `   → ${g.winner}${forced}`,
    );
  }
  lines.push("", `CHAMPION: ${champion}`);
  return lines.join("\n");
}

export function formatSeasonReport(result: NflSeasonResult, title = "NFL SEASON"): string {
  const { rows } = result.standings;
  const totalPts = rows.reduce((s, r) => s + r.pointsFor, 0);
  const perTeamGame = totalPts / (rows.length * 17);
  const header = [
    "=".repeat(60),
    `  ${title}`,
    `  ${result.games.length} games · ${perTeamGame.toFixed(1)} pts/team-game`,
    "=".repeat(60),
  ].join("\n");
  return [
    header,
    standingsBlock(rows),
    bracketBlock(result.playoffs.games, result.champion),
    "",
  ].join("\n");
}

/** One-line-per-division summary — handy for multi-season franchise dumps. */
export function formatStandingsCompact(result: NflSeasonResult): string {
  const rows = result.standings.rows;
  return DIVISION_IDS.map((div) => {
    const ordered = rows
      .filter((r) => r.division === div)
      .sort((a, b) => a.divisionRank - b.divisionRank)
      .map((r) => `${r.team} ${rec(r.wins, r.losses, r.ties)}`);
    return `${div.padEnd(10)} ${ordered.join(" · ")}`;
  }).join("\n");
}
