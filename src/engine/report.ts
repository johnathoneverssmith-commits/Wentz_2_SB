/**
 * Plain-text season report (Phase A1).
 *
 * Turns an `NflSeasonResult` into a monospace standings + bracket printout —
 * the stand-in "UI" until the franchise layer lands, and the shape any later
 * renderer will want.
 */

import { DIVISION_IDS, NFL_TEAMS, divisionsIn } from "./nfl-structure.js";
import type { PlayoffGame } from "./playoffs.js";
import { BYE_WEEK_RANGE, TRADE_DEADLINE_WEEK } from "./schedule.js";
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

/** "5×2 6×4 …" — how many teams are on bye in each week that has any. */
function byesByWeek(result: NflSeasonResult): string {
  const played = new Map<string, Set<number>>(NFL_TEAMS.map((t) => [t, new Set<number>()]));
  for (const g of result.games) {
    played.get(g.home)?.add(g.week);
    played.get(g.away)?.add(g.week);
  }
  const counts = new Map<number, number>();
  for (const t of NFL_TEAMS) {
    const bye = Array.from({ length: 18 }, (_, i) => i + 1).find((w) => !played.get(t)?.has(w));
    if (bye) counts.set(bye, (counts.get(bye) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([w, n]) => `${w}×${n}`)
    .join(" ");
}

export function formatSeasonReport(result: NflSeasonResult, title = "NFL SEASON"): string {
  const { rows } = result.standings;
  const totalPts = rows.reduce((s, r) => s + r.pointsFor, 0);
  const perTeamGame = totalPts / (rows.length * 17);
  const header = [
    "=".repeat(60),
    `  ${title}`,
    `  ${result.games.length} games · ${perTeamGame.toFixed(1)} pts/team-game`,
    `  byes (wk×teams, ${BYE_WEEK_RANGE[0]}–${BYE_WEEK_RANGE[1]}): ${byesByWeek(result)}`,
    `  trade deadline: after week ${TRADE_DEADLINE_WEEK}`,
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
