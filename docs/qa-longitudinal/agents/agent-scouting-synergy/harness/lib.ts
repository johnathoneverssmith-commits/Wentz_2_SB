/**
 * Shared helpers for the scouting/synergy experiments (real engine, no Mock).
 * ENGINE_ROOT selects the engine tree: the repo (baseline) or /tmp/proto (baseline + synergy-proto.patch).
 */
const ROOT = process.env.ENGINE_ROOT ?? new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
export const sim = await import(`${ROOT}/src/engine/sim.ts`);
export const rosterMod = await import(`${ROOT}/src/engine/roster.ts`);
export const boxMod = await import(`${ROOT}/src/engine/boxscore.ts`);
export const synergy = await import(`${ROOT}/src/engine/synergy.ts`);
export const staffMod = await import(`${ROOT}/src/engine/staff.ts`);
export const planMod = await import(`${ROOT}/src/engine/gameplan.ts`);
export const IS_PROTO = typeof synergy.PROTO !== "undefined";
export const teams: string[] = rosterMod.teamList();

export type P = any;
export const clone = (p: P, tag: string): P => ({ ...structuredClone(p), id: `${p.id}~${tag}` });
export function allPlayers(code: string): P[] {
  const seen = new Set<string>(); const out: P[] = [];
  for (const list of rosterMod.roster(code).depth.values()) for (const p of list) if (!seen.has(p.id)) { seen.add(p.id); out.push(p); }
  return out;
}
/** A fresh Roster for `code` with `edit(player, slotInfo)` applied to clones (fresh objects => fresh engine caches). */
export function build(code: string, tag: string, edit?: (p: P, pos: string, rank: number) => void) {
  const players = allPlayers(code).map((p) => clone(p, tag));
  if (edit) {
    const byPos = new Map<string, P[]>();
    for (const p of players) { const l = byPos.get(p.position) ?? []; l.push(p); byPos.set(p.position, l); }
    for (const [pos, l] of byPos) { l.sort((a, b) => b.overall - a.overall); l.forEach((p, i) => edit(p, pos, i)); }
  }
  return new rosterMod.Roster(code, players);
}
export const bump = (p: P, d: Record<string, number>) => { for (const [k, v] of Object.entries(d)) if (typeof p.attributes?.[k] === "number") p.attributes[k] = Math.max(20, Math.min(99, p.attributes[k] + v)); };
export const setTags = (p: P, tags: string[]) => { p.scheme_tags = tags; };

export function play(seed: number, home: string, away: string, hr: any, ar: any, opts: any = {}) {
  const g = sim.simulateGame(seed, home, away, { homeRoster: hr, awayRoster: ar, overtime: "nfl", talentScale: Number(process.env.TALENT ?? 1.5), ...opts });
  const b = boxMod.extractBoxScore(g, home, away);
  return { score: g.score as [number, number], home: b.home, away: b.away };
}
export const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
export const sd = (x: number[]) => { const m = mean(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1)); };
export const se = (x: number[]) => sd(x) / Math.sqrt(x.length);
let rs = 424242; export const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
export const ratings = await import(`${ROOT}/src/engine/ratings.ts`);
