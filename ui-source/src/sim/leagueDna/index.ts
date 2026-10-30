import type { LeagueProfile, Player, TendencyBand } from "@/domain";
import { classDnaFor, type ClassDna } from "./classDna.ts";
import { GEN_VERSION, drawLeagueDna, type GroupId, type LeagueDna } from "./dna.ts";
import { dealToTeams, generateFictionalPool } from "./generate.ts";
import { profileForPool } from "./eras.ts";
import { dnaSeedFor } from "./streams.ts";

export { GEN_VERSION } from "./dna.ts";
export type { ClassDna } from "./classDna.ts";

export interface DnaLeague {
  dna: LeagueDna;
  pool: Player[];
  profile: LeagueProfile;
}

/**
 * Everything a new league needs from its seed: the DNA, the players dealt
 * onto `teams` (the league's home teams, kept in `home_team` so switching
 * the fantasy draft off restores them), and the public profile.
 */
export function makeDnaLeague(seed: number, teams: readonly string[], reserved: Iterable<string> = []): DnaLeague {
  const dna = drawLeagueDna(dnaSeedFor(seed, GEN_VERSION));
  const pool = generateFictionalPool(dna, reserved);
  dealToTeams(pool, teams, dna.dnaSeed);
  for (const p of pool) if (p.nfl_team !== "FA") p.home_team = p.nfl_team;
  return { dna, pool, profile: profileForPool(pool) };
}

const BAND_VALUE: Record<TendencyBand, number> = { exceptional: 1.3, strong: 0.7, average: 0, limited: -0.7, scarce: -1.3 };

/** A draft class's character for a league, or undefined for a legacy league. */
export function classDnaForLeague(
  dna: { dnaSeed: number; profile: LeagueProfile } | undefined,
  year: number,
): { dnaSeed: number; cls: ClassDna } | undefined {
  if (!dna) return undefined;
  const opening = Object.fromEntries(
    Object.entries(dna.profile.tendencies).map(([g, b]) => [g, BAND_VALUE[b]]),
  ) as Partial<Record<GroupId, number>>;
  return { dnaSeed: dna.dnaSeed, cls: classDnaFor(dna.dnaSeed, year, opening) };
}
