/**
 * The rookie draft's order, by the NFL's rules (as far as this league's saved
 * data goes).
 *
 *  - Picks 1–18: the teams that missed the playoffs, worst record first.
 *  - Then the playoff teams by the round they went out in: wild-card losers,
 *    divisional losers, conference-final losers, the Super Bowl runner-up
 *    (second to last), the champion (last). Within a round, worst record first.
 *  - Teams level on record are separated by strength of schedule (the weaker
 *    schedule picks first), then by net points. What is still level is settled
 *    by a coin toss, fixed once per league and season.
 *  - Teams the coin toss separated rotate through the later rounds: a pair
 *    alternates, and in a group of three or more the team at the top of the
 *    group drops to the bottom each round while the others move up.
 *
 * Not modelled, because the league does not keep what they need: head-to-head,
 * division, conference and common-game tiebreakers (the NFL applies them
 * before net points), and strength of victory. A bracket this league does not
 * share with the NFL (a humans-only league's single bracket) or one that has
 * not finished gives the order by record alone, as the game always has.
 */
import type { LeagueState } from "@/domain";
import { ROUND_ORDER, type PlayoffRound } from "@/domain";

/** The picks a team earns, round by round: the team that holds each slot of that round. */
export type RoundOrders = (round: number) => string[];

const winPct = (t: { wins: number; losses: number; ties: number }): number => {
  const g = t.wins + t.losses + t.ties;
  return g === 0 ? 0.5 : (t.wins + 0.5 * t.ties) / g;
};

/** Combined record of every opponent a team played, each meeting counted. */
export function strengthOfSchedule(s: LeagueState): Record<string, number> {
  const games = s.games.filter((g) => g.phase === "REG");
  const faced: Record<string, string[]> = {};
  for (const g of games) {
    (faced[g.homeTeam] ??= []).push(g.awayTeam);
    (faced[g.awayTeam] ??= []).push(g.homeTeam);
  }
  const out: Record<string, number> = {};
  for (const code of Object.keys(s.teams)) {
    let credit = 0;
    let played = 0;
    for (const opp of faced[code] ?? []) {
      const t = s.teams[opp];
      if (!t) continue;
      credit += t.wins + 0.5 * t.ties;
      played += t.wins + t.losses + t.ties;
    }
    out[code] = played === 0 ? 0.5 : credit / played;
  }
  return out;
}

/** The coin toss: a fixed, league-and-season specific draw for each team. */
function coin(s: LeagueState, code: string): number {
  let h = 0x811c9dc5 ^ (((s.seed ?? 0) * 31 + s.season) >>> 0);
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Orders `codes` worst first, and returns them grouped: each inner array is a
 * run of teams only the coin toss separates (already in coin-toss order).
 */
function tiers(s: LeagueState, codes: string[], sos: Record<string, number>): string[][] {
  const net = (c: string): number => s.teams[c]!.pointsFor - s.teams[c]!.pointsAgainst;
  const key = (c: string): [number, number, number] => [winPct(s.teams[c]!), sos[c] ?? 0.5, net(c)];
  const sorted = [...codes].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || coin(s, a) - coin(s, b) || (a < b ? -1 : 1);
  });
  const groups: string[][] = [];
  for (const c of sorted) {
    const last = groups[groups.length - 1];
    if (last && key(last[0]!).every((v, i) => Math.abs(v - key(c)[i]!) < 1e-9)) last.push(c);
    else groups.push([c]);
  }
  return groups;
}

/** A tied group in its round: the coin-toss order, rotated one place a round. */
function rotated(group: string[], round: number): string[] {
  const k = (round - 1) % group.length;
  return [...group.slice(k), ...group.slice(0, k)];
}

/** The round each playoff team was eliminated in; null if the bracket is not complete. */
function eliminations(s: LeagueState): Map<string, PlayoffRound> | null {
  const b = s.bracket;
  if (!b || b.format === "single" || !b.champion || b.rounds) return null;
  const seeded = [...b.seeds.AFC, ...b.seeds.NFC];
  if (seeded.length === 0 || seeded.some((c) => !s.teams[c])) return null;
  const out = new Map<string, PlayoffRound>();
  for (const code of seeded) {
    if (code === b.champion) continue;
    let lost: PlayoffRound | null = null;
    for (const r of ROUND_ORDER) {
      const m = b.matchups.find((x) => x.round === r && (x.highSeed?.code === code || x.lowSeed?.code === code));
      if (!m) continue; // a first-round bye has no wild-card game
      if (m.winner == null) return null;
      if (m.winner !== code) {
        lost = r;
        break;
      }
    }
    if (!lost) return null;
    out.set(code, lost);
  }
  return out;
}

/**
 * The order the slots of each round are earned in, worst first: `(round) =>
 * codes`. Every team appears once per round.
 */
export function rookieRoundOrders(s: LeagueState): RoundOrders {
  const all = Object.keys(s.teams);
  const sos = strengthOfSchedule(s);
  const out = eliminations(s);

  // [the teams in each stage of the order, earliest stage first]
  let stages: string[][];
  if (out) {
    const inPlayoffs = new Set(out.keys());
    inPlayoffs.add(s.bracket!.champion!);
    const wentOutIn = (r: PlayoffRound) => [...out.entries()].filter(([, round]) => round === r).map(([c]) => c);
    stages = [
      all.filter((c) => !inPlayoffs.has(c)),
      wentOutIn("WC"),
      wentOutIn("DIV"),
      wentOutIn("CONF"),
      wentOutIn("SB"),
      [s.bracket!.champion!],
    ];
  } else {
    stages = [all];
  }
  const tiered = stages.map((codes) => tiers(s, codes, sos));
  return (round) => tiered.flatMap((groups) => groups.flatMap((g) => rotated(g, round)));
}
