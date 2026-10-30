import type { LeagueProfile } from "@/domain";
import { neutralTop } from "./targets.ts";
import { type Axes, axesOf, groupScores, tendenciesOf, tendencySentence, type Scouted, archetypeShares } from "./profile.ts";

/**
 * A small catalogue of NFL eras, used only to describe a league that has
 * already been generated.
 *
 * What these numbers are, honestly: each era is placed on four axes (passing,
 * ground game, pass-rush/front seven, coverage) from public, aggregate team
 * statistics and well-known history, as an *emphasis* in roughly -1..+1. They
 * are qualitative analogies chosen by the maintainers, not measurements of
 * historical player ratings (there are no public ratings to measure), and not
 * a rule set. `note` records the public record each placement leans on; see
 * `docs/LEAGUE_DNA_ERAS.md` for sources and limits.
 */
export interface Era {
  id: string;
  title: string;
  /** where this era sits on the matching axes */
  axes: Axes;
  /** one-clause description for the profile text */
  gist: string;
  note: string;
}

export const ERAS: readonly Era[] = [
  {
    id: "2000",
    title: "2000-Era NFL",
    axes: { passing: -0.5, ground: 0.5, front: 0.3, coverage: 0.2 },
    gist: "a low-scoring, defence-and-ground-game environment",
    note: "League scoring averaged about 20.7 points per team-game in 2000 (nfldata.org), the low end of the modern range.",
  },
  {
    id: "2011",
    title: "2011-Era NFL",
    axes: { passing: 0.9, ground: -0.3, front: 0, coverage: -0.4 },
    gist: "the early-2010s passing boom",
    note: "2011 had three 5,000-yard passers (Brees 5,476, Brady 5,235, Stafford 5,038); scoring rose from ~22.0 (2010) toward the 2013 high.",
  },
  {
    id: "2013",
    title: "2013-Era NFL",
    axes: { passing: 0.7, ground: 0.2, front: 0.2, coverage: -0.2 },
    gist: "a high-scoring era where strong offences and strong pass rushes both thrived",
    note: "2013 set the then-record scoring average (~23.4 points per team-game) and Peyton Manning's 5,477 passing yards.",
  },
  {
    id: "2020",
    title: "2020-Era NFL",
    axes: { passing: 0.5, ground: 0.4, front: -0.1, coverage: -0.3 },
    gist: "versatile modern offences, with mobile quarterbacks and balanced attacks",
    note: "2020 averaged ~24.8 points per team-game, the highest of the period examined.",
  },
  {
    id: "2024",
    title: "2024-Era NFL",
    axes: { passing: -0.1, ground: 0.2, front: 0.5, coverage: 0.4 },
    gist: "a defence-led environment with fewer passes and lower scoring",
    note: "2024 had the fewest combined pass attempts per game since 2008 and scoring had fallen for years running.",
  },
];

/** A pool further than this from every era gets a fictional-era description instead of a forced match. */
export const MATCH_CUTOFF = 1.0;

const dist = (a: Axes, b: Axes) => Math.hypot(a.passing - b.passing, a.ground - b.ground, a.front - b.front, a.coverage - b.coverage);

/** Axis scale: pool axes are in tendency units (sd about 0.7 across leagues); eras sit in roughly +-1. Chosen with `analysis`-style sampling of 300 leagues so about half match an era and every era is reachable. */
export const AXIS_GAIN = 0.8;

export function matchEra(axes: Axes): { era: Era; distance: number } | null {
  const scaled: Axes = { passing: axes.passing * AXIS_GAIN, ground: axes.ground * AXIS_GAIN, front: axes.front * AXIS_GAIN, coverage: axes.coverage * AXIS_GAIN };
  let best: { era: Era; distance: number } | null = null;
  for (const era of ERAS) {
    const d = dist(scaled, era.axes);
    if (!best || d < best.distance) best = { era, distance: d };
  }
  return best && best.distance <= MATCH_CUTOFF ? best : null;
}

function fictionalTitle(axes: Axes): string {
  const lead = (Object.entries(axes) as [keyof Axes, number][]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0]!;
  const high = lead[1] >= 0;
  const names: Record<keyof Axes, [string, string]> = {
    passing: ["Air-Starved", "Aerial"],
    ground: ["Finesse", "Ground-and-Pound"],
    front: ["Quiet Trenches", "Trench"],
    coverage: ["Open Secondary", "Lockdown"],
  };
  return `${names[lead[0]][high ? 1 : 0]} Era (fictional)`;
}

/** The public profile of a generated pool. */
export function profileForPool(players: readonly Scouted[]): LeagueProfile {
  const g = groupScores(players, neutralTop());
  const axes = axesOf(g, archetypeShares(players));
  const match = matchEra(axes);
  const lean = tendencySentence(g, "This league");
  if (match) {
    return {
      eraId: match.era.id,
      title: match.era.title,
      blurb: `This fictional league resembles ${match.era.gist}. ${lean} The comparison is an analogy, not a rule: nothing about this league follows that era's history.`,
      tendencies: tendenciesOf(g),
    };
  }
  return {
    eraId: null,
    title: fictionalTitle(axes),
    blurb: `This fictional league does not closely resemble any era we compare against. ${lean}`,
    tendencies: tendenciesOf(g),
  };
}
