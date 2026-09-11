import type { TeamMeta } from "@/domain";

/**
 * The 32 real NFL teams (spec §1: real names, cities, colors). Player and coach
 * names elsewhere are fictional; team identity is real.
 */
export const TEAMS: TeamMeta[] = [
  // AFC North
  { code: "BAL", city: "Baltimore", name: "Ravens", abbr: "BAL", color: "#241773", onColor: "#fff", conference: "AFC", division: "North" },
  { code: "CIN", city: "Cincinnati", name: "Bengals", abbr: "CIN", color: "#FB4F14", onColor: "#fff", conference: "AFC", division: "North" },
  { code: "CLE", city: "Cleveland", name: "Browns", abbr: "CLE", color: "#FF3C00", onColor: "#fff", conference: "AFC", division: "North" },
  { code: "PIT", city: "Pittsburgh", name: "Steelers", abbr: "PIT", color: "#FFB612", onColor: "#101820", conference: "AFC", division: "North" },
  // AFC South
  { code: "HOU", city: "Houston", name: "Texans", abbr: "HOU", color: "#03202F", onColor: "#fff", accent: "#A71930", onAccent: "#fff", conference: "AFC", division: "South" },
  { code: "IND", city: "Indianapolis", name: "Colts", abbr: "IND", color: "#002C5F", onColor: "#fff", conference: "AFC", division: "South" },
  { code: "JAX", city: "Jacksonville", name: "Jaguars", abbr: "JAX", color: "#006778", onColor: "#fff", conference: "AFC", division: "South" },
  { code: "TEN", city: "Tennessee", name: "Titans", abbr: "TEN", color: "#0C2340", onColor: "#fff", accent: "#4B92DB", onAccent: "#fff", conference: "AFC", division: "South" },
  // AFC East
  { code: "BUF", city: "Buffalo", name: "Bills", abbr: "BUF", color: "#00338D", onColor: "#fff", accent: "#C60C30", onAccent: "#fff", conference: "AFC", division: "East" },
  { code: "MIA", city: "Miami", name: "Dolphins", abbr: "MIA", color: "#008E97", onColor: "#fff", conference: "AFC", division: "East" },
  { code: "NE", city: "New England", name: "Patriots", abbr: "NE", color: "#002244", onColor: "#fff", accent: "#C60C30", onAccent: "#fff", conference: "AFC", division: "East" },
  { code: "NYJ", city: "New York", name: "Jets", abbr: "NYJ", color: "#125740", onColor: "#fff", conference: "AFC", division: "East" },
  // AFC West
  { code: "DEN", city: "Denver", name: "Broncos", abbr: "DEN", color: "#FB4F14", onColor: "#fff", conference: "AFC", division: "West" },
  { code: "KC", city: "Kansas City", name: "Chiefs", abbr: "KC", color: "#E31837", onColor: "#fff", conference: "AFC", division: "West" },
  { code: "LV", city: "Las Vegas", name: "Raiders", abbr: "LV", color: "#000000", onColor: "#fff", accent: "#A5ACAF", onAccent: "#000", conference: "AFC", division: "West" },
  { code: "LAC", city: "Los Angeles", name: "Chargers", abbr: "LAC", color: "#0080C6", onColor: "#fff", conference: "AFC", division: "West" },
  // NFC North
  { code: "CHI", city: "Chicago", name: "Bears", abbr: "CHI", color: "#0B162A", onColor: "#fff", accent: "#C83803", onAccent: "#fff", conference: "NFC", division: "North" },
  { code: "DET", city: "Detroit", name: "Lions", abbr: "DET", color: "#0076B6", onColor: "#fff", conference: "NFC", division: "North" },
  { code: "GB", city: "Green Bay", name: "Packers", abbr: "GB", color: "#203731", onColor: "#fff", accent: "#FFB81C", onAccent: "#203731", conference: "NFC", division: "North" },
  { code: "MIN", city: "Minnesota", name: "Vikings", abbr: "MIN", color: "#4F2683", onColor: "#fff", conference: "NFC", division: "North" },
  // NFC South
  { code: "ATL", city: "Atlanta", name: "Falcons", abbr: "ATL", color: "#A71930", onColor: "#fff", conference: "NFC", division: "South" },
  { code: "CAR", city: "Carolina", name: "Panthers", abbr: "CAR", color: "#0085CA", onColor: "#fff", conference: "NFC", division: "South" },
  { code: "NO", city: "New Orleans", name: "Saints", abbr: "NO", color: "#D3BC8D", onColor: "#101820", conference: "NFC", division: "South" },
  { code: "TB", city: "Tampa Bay", name: "Buccaneers", abbr: "TB", color: "#D50A0A", onColor: "#fff", conference: "NFC", division: "South" },
  // NFC East
  { code: "DAL", city: "Dallas", name: "Cowboys", abbr: "DAL", color: "#003594", onColor: "#fff", accent: "#869397", onAccent: "#000", conference: "NFC", division: "East" },
  { code: "NYG", city: "New York", name: "Giants", abbr: "NYG", color: "#0B2265", onColor: "#fff", accent: "#A71930", onAccent: "#fff", conference: "NFC", division: "East" },
  { code: "PHI", city: "Philadelphia", name: "Eagles", abbr: "PHI", color: "#004C54", onColor: "#fff", accent: "#A5ACAF", onAccent: "#000", conference: "NFC", division: "East" },
  { code: "WAS", city: "Washington", name: "Commanders", abbr: "WAS", color: "#5A1414", onColor: "#fff", accent: "#FFB612", onAccent: "#5A1414", conference: "NFC", division: "East" },
  // NFC West
  { code: "ARI", city: "Arizona", name: "Cardinals", abbr: "ARI", color: "#97233F", onColor: "#fff", conference: "NFC", division: "West" },
  { code: "LAR", city: "Los Angeles", name: "Rams", abbr: "LAR", color: "#003594", onColor: "#fff", accent: "#FFA300", onAccent: "#000", conference: "NFC", division: "West" },
  { code: "SF", city: "San Francisco", name: "49ers", abbr: "SF", color: "#AA0000", onColor: "#fff", conference: "NFC", division: "West" },
  { code: "SEA", city: "Seattle", name: "Seahawks", abbr: "SEA", color: "#002244", onColor: "#fff", accent: "#69BE28", onAccent: "#002244", conference: "NFC", division: "West" },
];

/** Teams grouped the way the league is organised: conference → division. */
export const DIVISIONS: Array<{ conference: "AFC" | "NFC"; division: string; teams: TeamMeta[] }> = (() => {
  const out: Array<{ conference: "AFC" | "NFC"; division: string; teams: TeamMeta[] }> = [];
  for (const t of TEAMS) {
    let g = out.find((x) => x.conference === t.conference && x.division === t.division);
    if (!g) {
      g = { conference: t.conference, division: t.division, teams: [] };
      out.push(g);
    }
    g.teams.push(t);
  }
  return out;
})();

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

function mixToward(hex: string, target: string, amount: number): string {
  const a = parseInt(hex.replace("#", ""), 16);
  const b = parseInt(target.replace("#", ""), 16);
  const mix = (x: number, y: number) => Math.round(x + (y - x) * amount);
  const r = mix((a >> 16) & 255, (b >> 16) & 255);
  const g = mix((a >> 8) & 255, (b >> 8) & 255);
  const bl = mix(a & 255, b & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/**
 * The accent the UI should actually paint with for a team: its official
 * lighter secondary when one is listed, otherwise its primary lifted just far
 * enough toward white to read against the near-black panels (deep navies like
 * the Colts' would otherwise disappear as button fills and accent text).
 */
export function readableAccent(t: TeamMeta): { color: string; onColor: string } {
  if (t.accent) return { color: t.accent, onColor: t.onAccent ?? "#fff" };
  let c = t.color;
  let guard = 0;
  while (relativeLuminance(c) < 0.09 && guard++ < 12) c = mixToward(c, "#ffffff", 0.14);
  return { color: c, onColor: relativeLuminance(c) > 0.4 ? "#000" : "#fff" };
}

export const TEAMS_BY_CODE: Record<string, TeamMeta> = Object.fromEntries(
  TEAMS.map((t) => [t.code, t]),
);

export function teamMeta(code: string): TeamMeta {
  const t = TEAMS_BY_CODE[code];
  if (!t) throw new Error(`unknown team code: ${code}`);
  return t;
}

export function teamFullName(code: string): string {
  const t = teamMeta(code);
  return `${t.city} ${t.name}`;
}

/** Darken a hex color toward black for the --team-deep header wash. */
export function deepen(hex: string, amount = 0.82): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
