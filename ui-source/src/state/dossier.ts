import type { Contract, Player, Position } from "@/domain";

/**
 * Scouting dossier data for one player — pure, so it can be tested and so a
 * future player model flows through without UI changes.
 *
 * Rules this enforces:
 * - Only attributes the player actually has are listed; nothing is invented.
 * - `potential` (a hidden ceiling) is never read here.
 * - The comparison average is the mean of the same attribute across every
 *   non-retired player at the same position in the league right now, so it
 *   moves as the league does. It is null when fewer than 2 players have it.
 */
export interface DossierSkill {
  key: string;
  label: string;
  value: number;
  /** league-wide positional average, one decimal; null when unavailable */
  average: number | null;
  /** value - average, one decimal; null when no average */
  diff: number | null;
}

export interface Dossier {
  skills: DossierSkill[];
  /** same position, how many players the averages were drawn from */
  sample: number;
  overall: { value: number; average: number | null; diff: number | null };
  contract: Pick<Contract, "years_remaining" | "total_value" | "guaranteed"> & { capHit: number } | null;
  /** present only for drafted-regime players */
  draft: string | null;
}

export function humanizeAttribute(key: string): string {
  const map: Record<string, string> = { pass_block: "Pass blocking", run_block: "Run blocking", man_coverage: "Man coverage", zone_coverage: "Zone coverage", play_recognition: "Play recognition", throw_power: "Throw power", throw_accuracy_short: "Short accuracy", throw_accuracy_mid: "Medium accuracy", throw_accuracy_deep: "Deep accuracy" };
  if (map[key]) return map[key]!;
  const t = key.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function positionAverages(players: Record<string, Player>, position: Position): { sum: Record<string, number>; count: Record<string, number>; n: number; overall: number } {
  const sum: Record<string, number> = {};
  const count: Record<string, number> = {};
  let n = 0;
  let overall = 0;
  for (const p of Object.values(players)) {
    if (p.position !== position || p.retired) continue;
    n += 1;
    overall += p.overall;
    for (const [k, v] of Object.entries(p.attributes)) {
      if (typeof v !== "number") continue;
      sum[k] = (sum[k] ?? 0) + v;
      count[k] = (count[k] ?? 0) + 1;
    }
  }
  return { sum, count, n, overall };
}

export function buildDossier(player: Player, players: Record<string, Player>): Dossier {
  const agg = positionAverages(players, player.position);
  const avg = (k: string): number | null => ((agg.count[k] ?? 0) >= 2 ? r1(agg.sum[k]! / agg.count[k]!) : null);
  const skills: DossierSkill[] = Object.entries(player.attributes)
    .filter(([, v]) => typeof v === "number")
    .map(([key, value]) => {
      const average = avg(key);
      return { key, label: humanizeAttribute(key), value, average, diff: average === null ? null : r1(value - average) };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const ovrAvg = agg.n >= 2 ? r1(agg.overall / agg.n) : null;
  const c = player.contract;
  return {
    skills,
    sample: agg.n,
    overall: { value: player.overall, average: ovrAvg, diff: ovrAvg === null ? null : r1(player.overall - ovrAvg) },
    contract: c ? { years_remaining: c.years_remaining, total_value: c.total_value, guaranteed: c.guaranteed, capHit: c.cap_hit_by_year[0] ?? 0 } : null,
    draft: player.draft_info ? `${player.draft_info.class_year} round ${player.draft_info.round}, pick ${player.draft_info.pick}` : null,
  };
}

/** "+3.2", "−1.0", "0.0" — a real minus sign, and an explicit plus. */
export function signed(n: number | null): string {
  if (n === null) return "—";
  if (n === 0) return "0.0";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
}
