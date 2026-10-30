import type { Position } from "@/domain";
import { POSITIONS } from "@/domain";
import { ARCHETYPES_BY_POSITION } from "./archetypes.ts";
import { GROUP_OF, type GroupId } from "./dna.ts";
import { stream } from "./streams.ts";

/**
 * One draft class's character, drawn from (dnaSeed, year) alone.
 *
 * Independent of the opening league's DNA by construction: its own streams,
 * its own group factors. The only link is `CULTURE`, a small share of the
 * league's opening tendencies, which keeps a league feeling like itself
 * without letting its first draft dictate every class after it.
 */
export interface ClassDna {
  year: number;
  /** points added to every prospect's true overall */
  quality: number;
  /** multiplier on how often exceptional prospects appear */
  tail: number;
  positions: Record<Position, { supply: number; quality: number; tail: number; archetypes: Record<string, number> }>;
}

/** Share of the opening league's group tendency a class inherits. */
export const CULTURE = 0.12;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const CLASS_TUNING = {
  qualitySd: 1.3,
  qualityLimit: 3.5,
  groupSd: 3.0,
  posSd: 1.4,
  posLimit: 6.5,
  supplyLimit: [0.6, 1.6] as const,
  tailSd: 0.35,
};

export function classDnaFor(dnaSeed: number, year: number, openingGroups?: Partial<Record<GroupId, number>>): ClassDna {
  const r = stream(dnaSeed, "class", year);
  const quality = clamp(r.normal(0, CLASS_TUNING.qualitySd), -CLASS_TUNING.qualityLimit, CLASS_TUNING.qualityLimit);
  const tail = clamp(Math.exp(r.normal(0, CLASS_TUNING.tailSd)), 0.4, 2.2);
  const off = r.normal();
  const def = r.normal();
  const group: Record<string, number> = {};
  const loads: Record<GroupId, [number, number]> = {
    passing: [0.5, 0], receivers: [0.4, 0], line: [0.3, 0], backfield: [0.2, 0],
    front: [0, 0.45], secondary: [0, 0.4], specialists: [0, 0],
  };
  for (const [id, [a, d]] of Object.entries(loads) as [GroupId, [number, number]][]) {
    group[id] = a * off + d * def + (1 - Math.hypot(a, d) * 0.6) * r.normal() + CULTURE * (openingGroups?.[id] ?? 0);
  }
  const positions = {} as ClassDna["positions"];
  for (const pos of POSITIONS) {
    const pr = stream(dnaSeed, "class", year, pos);
    const g = group[GROUP_OF[pos]] ?? 0;
    const q = clamp(g * CLASS_TUNING.groupSd * 0.7 + pr.normal(0, CLASS_TUNING.posSd), -CLASS_TUNING.posLimit, CLASS_TUNING.posLimit);
    const archetypes: Record<string, number> = {};
    for (const a of ARCHETYPES_BY_POSITION[pos] ?? []) archetypes[a.id] = Math.exp(pr.normal(0, 0.55));
    positions[pos] = {
      quality: q,
      // a strong group brings more bodies too, a weak one fewer
      supply: clamp(Math.exp(0.05 * q + pr.normal(0, 0.18)), CLASS_TUNING.supplyLimit[0], CLASS_TUNING.supplyLimit[1]),
      tail: clamp(Math.exp(pr.normal(0, CLASS_TUNING.tailSd)) * (1 + 0.04 * q), 0.4, 2.4),
      archetypes,
    };
  }
  return { year, quality, tail, positions };
}
