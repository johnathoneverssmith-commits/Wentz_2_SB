import type { LeagueProfile, Position, TendencyBand } from "@/domain";
import { ROSTER_TEMPLATE } from "../roster-template.ts";
import { GROUP_OF, type GroupId } from "./dna.ts";
import { ARCHETYPES_BY_POSITION } from "./archetypes.ts";

/**
 * Reading a talent pool: what it is deep in and what it lacks, in words.
 * Everything here works from a list of {position, overall, archetype}; it
 * never sees potential, and it publishes bands, not numbers.
 */
export interface Scouted {
  position: Position;
  overall: number;
  archetype?: string | undefined;
}

/** Rating points per unit of tendency. */
const UNIT = 3;

export const GROUPS: readonly GroupId[] = ["passing", "receivers", "line", "backfield", "front", "secondary", "specialists"];

/** How many players of a position count as its top tier in a league of `teams` teams: the starters. */
function topCount(pos: Position, teams: number): number {
  const s = ROSTER_TEMPLATE.find((r) => r.pos === pos)?.starters ?? 0;
  return s * teams;
}

export function topMeans(players: readonly Scouted[], teams = 32): Partial<Record<Position, number>> {
  const by = new Map<Position, number[]>();
  for (const p of players) {
    const l = by.get(p.position);
    if (l) l.push(p.overall);
    else by.set(p.position, [p.overall]);
  }
  const out: Partial<Record<Position, number>> = {};
  for (const [pos, list] of by) {
    const n = topCount(pos, teams);
    if (n === 0) continue;
    const top = list.sort((a, b) => b - a).slice(0, n);
    out[pos] = top.reduce((a, b) => a + b, 0) / top.length;
  }
  return out;
}

/** Group score: mean over its positions of (top-tier mean - neutral) / UNIT. Positive is deep. */
export function groupScores(players: readonly Scouted[], neutral: Partial<Record<Position, number>>, teams = 32): Record<GroupId, number> {
  const tops = topMeans(players, teams);
  const acc: Record<string, number[]> = {};
  for (const [pos, m] of Object.entries(tops) as [Position, number][]) {
    const base = neutral[pos];
    if (base === undefined) continue;
    (acc[GROUP_OF[pos]] ??= []).push((m - base) / UNIT);
  }
  return Object.fromEntries(
    GROUPS.map((g) => [g, acc[g] ? acc[g]!.reduce((a, b) => a + b, 0) / acc[g]!.length : 0]),
  ) as Record<GroupId, number>;
}

export function bandOf(score: number): TendencyBand {
  if (score >= 1.0) return "exceptional";
  if (score >= 0.45) return "strong";
  if (score > -0.45) return "average";
  if (score > -1.0) return "limited";
  return "scarce";
}

/** The mean overall-weighted pull of a pool towards each archetype, as a share of its position (0-1). */
export function archetypeShares(players: readonly Scouted[]): Record<string, number> {
  const total = new Map<Position, number>();
  const per = new Map<string, number>();
  for (const p of players) {
    if (!p.archetype) continue;
    total.set(p.position, (total.get(p.position) ?? 0) + 1);
    per.set(p.archetype, (per.get(p.archetype) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const [pos, list] of Object.entries(ARCHETYPES_BY_POSITION)) {
    for (const a of list) out[a.id] = (per.get(a.id) ?? 0) / Math.max(1, total.get(pos as Position) ?? 0);
  }
  return out;
}

/** Four-axis read of a pool, the space eras are matched in. */
export interface Axes {
  passing: number;
  ground: number;
  front: number;
  coverage: number;
}
export function axesOf(g: Record<GroupId, number>, shares: Record<string, number>): Axes {
  // mobile quarterbacks and speed backs lean the ground game and the modern offence; they nudge, not decide
  const mobile = (shares.qb_mobile ?? 0.33) - 0.33;
  return {
    passing: 0.45 * g.passing + 0.4 * g.receivers + 0.15 * g.line,
    ground: 0.5 * g.backfield + 0.4 * g.line + 0.1 * mobile * 3,
    front: g.front,
    coverage: g.secondary,
  };
}

const PHRASE: Record<GroupId, [string, string]> = {
  passing: ["quarterback talent", "quarterbacks"],
  receivers: ["receiving talent", "receivers and tight ends"],
  line: ["offensive-line talent", "offensive linemen"],
  backfield: ["running-back talent", "running backs"],
  front: ["defensive-front talent", "pass rushers and front-seven players"],
  secondary: ["defensive-back talent", "defensive backs"],
  specialists: ["kicking talent", "kickers and punters"],
};

const DEEP_WORD: Record<TendencyBand, string> = {
  exceptional: "unusually deep",
  strong: "deep",
  average: "ordinary",
  limited: "thin",
  scarce: "scarce",
};

/** One sentence naming the two clearest strengths and the clearest weakness. */
export function tendencySentence(g: Record<GroupId, number>, scope: string): string {
  const ranked = (Object.entries(g) as [GroupId, number][]).filter(([id]) => id !== "specialists").sort((a, b) => b[1] - a[1]);
  const high = ranked.filter(([, v]) => v >= 0.45).slice(0, 2);
  const low = ranked.filter(([, v]) => v <= -0.45).slice(-1);
  const parts: string[] = [];
  if (high.length) {
    parts.push(`${cap(PHRASE[high[0]![0]][0])} is ${DEEP_WORD[bandOf(high[0]![1])]}` + (high[1] ? `, and ${PHRASE[high[1][0]][0]} is ${DEEP_WORD[bandOf(high[1][1])]}` : ""));
  }
  if (low.length) parts.push(`${cap(PHRASE[low[0]![0]][1])} are ${DEEP_WORD[bandOf(low[0]![1])]}`);
  if (!parts.length) return `${scope} has no clear lean: talent is spread evenly across the field.`;
  return parts.join("; ") + ".";
}
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function tendenciesOf(g: Record<GroupId, number>): Record<string, TendencyBand> {
  return Object.fromEntries(GROUPS.map((id) => [id, bandOf(g[id])]));
}

export type { LeagueProfile };
