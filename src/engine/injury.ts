/**
 * In-game injuries (franchise flavour, opt-in).
 *
 * When enabled, the game loop rolls a small per-scrimmage-play hazard; on a hit
 * this picks a player who was plausibly involved, a body part weighted by their
 * position, an injury type + severity → a projected return window, and a
 * mechanism drawn from the play that just happened. The result is a structured
 * `InjuryEvent` plus a broadcast-ready sentence:
 *
 *   "A.J. Brown's ankle rolled under a defender's knee while completing a
 *    15-yard post. Exact injury unknown, but feared to be an ankle fracture.
 *    Projected 4–6 weeks."
 *
 * Deterministic in the game RNG. Off by default (`simulateGame` without the
 * flag) so the validation / parity paths are untouched. Mirrored by
 * `analysis/engine/injury.py`.
 */

import type { Player } from "../schema/player.js";
import type { Rng } from "./rng.js";

export type InjurySeverity = "minor" | "moderate" | "significant" | "severe" | "season";

export interface InjuryEvent {
  team: string;
  playerId: string;
  player: string;
  position: string;
  /** lineup slot the player held (QB1, WR2, EDGE1, …). */
  slot: string;
  quarter: number;
  /** game clock at the injury, "mm:ss" remaining in the quarter. */
  clock: string;
  bodyPart: string;
  /** the reported/suspected diagnosis (the "true" injury is not modelled in v1). */
  suspectedType: string;
  severity: InjurySeverity;
  /** [min, max] weeks the player is expected to miss (0,0 = day-to-day). */
  projectedWeeks: [number, number];
  /** short mechanism phrase, e.g. "rolled under a defender's knee". */
  mechanism: string;
  /** what the player was doing, e.g. "completing a 15-yard post". */
  onPlay: string;
  /** the full broadcast sentence. */
  narrative: string;
}

/** Context the game loop hands the roller for the play that just finished. */
export interface InjuryPlayContext {
  offenseTeam: string;
  defenseTeam: string;
  quarter: number;
  clock: string;
  /** "pass" | "run" | "sack" | "scramble" */
  call: string;
  outcome: string; // "complete" | "incomplete" | "sack" | "run" | "scramble" | "interception"
  gained: number;
  /** air-yard depth bucket for passes: BEHIND_LOS | SHORT | INTERMEDIATE | DEEP | "" */
  depth: string;
  /** candidate players with a lineup slot; the offense's + defense's on-field units. */
  offense: { slot: string; player: Player | null | undefined }[];
  defense: { slot: string; player: Player | null | undefined }[];
}

// --- tables -------------------------------------------------------------

type Band = readonly [number, number]; // [minWeeks, maxWeeks]

interface TypeRow {
  type: string;
  severity: InjurySeverity;
  weeks: Band;
  w: number; // relative weight
}

const BODY_TYPES: Record<string, TypeRow[]> = {
  ankle: [
    { type: "ankle sprain", severity: "minor", weeks: [0, 1], w: 34 },
    { type: "high-ankle sprain", severity: "moderate", weeks: [3, 6], w: 12 },
    { type: "ankle fracture", severity: "significant", weeks: [6, 10], w: 4 },
  ],
  knee: [
    { type: "knee sprain", severity: "minor", weeks: [1, 2], w: 24 },
    { type: "MCL sprain", severity: "moderate", weeks: [3, 6], w: 12 },
    { type: "meniscus tear", severity: "significant", weeks: [4, 8], w: 6 },
    { type: "PCL sprain", severity: "moderate", weeks: [4, 8], w: 3 },
    { type: "ACL tear", severity: "season", weeks: [40, 52], w: 2 },
  ],
  hamstring: [
    { type: "hamstring strain", severity: "minor", weeks: [1, 2], w: 30 },
    { type: "grade-2 hamstring strain", severity: "moderate", weeks: [3, 5], w: 10 },
  ],
  groin: [
    { type: "groin strain", severity: "minor", weeks: [1, 3], w: 26 },
    { type: "adductor tear", severity: "moderate", weeks: [4, 7], w: 5 },
  ],
  shoulder: [
    { type: "AC joint sprain", severity: "minor", weeks: [1, 3], w: 24 },
    { type: "shoulder subluxation", severity: "moderate", weeks: [2, 5], w: 8 },
    { type: "labrum tear", severity: "significant", weeks: [5, 10], w: 4 },
  ],
  concussion: [{ type: "concussion", severity: "moderate", weeks: [1, 3], w: 40 }],
  hand: [
    { type: "hand sprain", severity: "minor", weeks: [0, 1], w: 26 },
    { type: "hand fracture", severity: "moderate", weeks: [3, 6], w: 8 },
  ],
  ribs: [
    { type: "rib contusion", severity: "minor", weeks: [1, 2], w: 28 },
    { type: "rib fracture", severity: "moderate", weeks: [2, 5], w: 8 },
  ],
  foot: [
    { type: "foot sprain", severity: "minor", weeks: [1, 3], w: 22 },
    { type: "turf toe", severity: "moderate", weeks: [2, 6], w: 6 },
    { type: "Lisfranc injury", severity: "significant", weeks: [8, 14], w: 2 },
    { type: "foot fracture", severity: "significant", weeks: [6, 10], w: 3 },
  ],
  back: [
    { type: "back spasms", severity: "minor", weeks: [0, 1], w: 26 },
    { type: "back strain", severity: "moderate", weeks: [2, 4], w: 8 },
  ],
  calf: [{ type: "calf strain", severity: "minor", weeks: [1, 3], w: 20 }],
  quad: [{ type: "quad contusion", severity: "minor", weeks: [0, 2], w: 20 }],
  biceps: [
    { type: "biceps strain", severity: "minor", weeks: [1, 3], w: 14 },
    { type: "biceps tear", severity: "severe", weeks: [16, 26], w: 1 },
  ],
  elbow: [{ type: "elbow hyperextension", severity: "minor", weeks: [1, 3], w: 14 }],
};

/** body-part weights by position group. */
const POS_GROUP: Record<string, string> = {
  QB: "QB",
  RB: "SKILL",
  FB: "SKILL",
  WR: "SKILL",
  TE: "SKILL",
  OT: "OL",
  OG: "OL",
  C: "OL",
  EDGE: "DL",
  DT: "DL",
  ILB: "LB",
  OLB: "LB",
  LB: "LB",
  CB: "DB",
  S: "DB",
  K: "SPEC",
  P: "SPEC",
  LS: "SPEC",
};

const GROUP_BODY: Record<string, [string, number][]> = {
  QB: [["shoulder", 22], ["hand", 20], ["knee", 16], ["ankle", 14], ["ribs", 12], ["concussion", 10], ["back", 6]],
  SKILL: [["hamstring", 22], ["ankle", 20], ["knee", 18], ["foot", 10], ["shoulder", 10], ["concussion", 8], ["groin", 8], ["ribs", 4]],
  OL: [["knee", 22], ["ankle", 20], ["back", 14], ["shoulder", 12], ["foot", 12], ["biceps", 8], ["elbow", 6], ["concussion", 6]],
  DL: [["knee", 20], ["ankle", 18], ["shoulder", 14], ["foot", 12], ["hand", 10], ["biceps", 10], ["elbow", 8], ["concussion", 8]],
  LB: [["knee", 20], ["ankle", 18], ["hamstring", 16], ["shoulder", 14], ["concussion", 12], ["foot", 10], ["ribs", 10]],
  DB: [["hamstring", 24], ["ankle", 18], ["knee", 16], ["shoulder", 12], ["concussion", 12], ["groin", 10], ["foot", 8]],
  SPEC: [["groin", 30], ["quad", 24], ["back", 24], ["knee", 12], ["calf", 10]],
};

const LOWER = new Set(["ankle", "knee", "hamstring", "foot", "calf", "quad", "groin"]);
const HEAD = new Set(["concussion"]);

/**
 * Mechanism *verb phrases* by [region][contact?]. The narrative reads
 * "{Player}'s {bodyPart} {phrase} while {onPlay}", so the phrase must NOT
 * re-name the body part. `head` is templated separately (no body part).
 */
const MECH: Record<string, { contact: string[]; noncontact: string[] }> = {
  lower: {
    contact: [
      "rolled under a defender's knee",
      "got bent awkwardly at the bottom of the pile",
      "was rolled up on from behind",
      "got caught under a tackler and twisted",
      "gave out as he was driven into the turf",
      "took the brunt of a low hit",
    ],
    noncontact: [
      "buckled changing direction with no one around",
      "gave out on the cut",
      "locked up as he planted",
      "went out from under him untouched",
      "tightened up and forced him off the field",
    ],
  },
  upper: {
    contact: [
      "took the force of a hard landing",
      "got bent back on contact",
      "absorbed a direct shot",
      "was wrenched in a pile-up",
      "jammed into the turf",
    ],
    noncontact: [
      "flared up in visible discomfort",
      "stiffened up on the sideline",
      "aggravated on a routine play",
    ],
  },
  head: { contact: [], noncontact: [] },
};

const HEAD_MECH_CONTACT = [
  "took a helmet-to-helmet hit",
  "was slow to get up after a collision",
  "had his head snap back on a hit",
  "absorbed a blindside shot",
];
const HEAD_MECH_NONCONTACT = ["reported concussion symptoms to the training staff"];

const ROUTE_BY_DEPTH: Record<string, string[]> = {
  BEHIND_LOS: ["screen", "checkdown", "swing route"],
  SHORT: ["slant", "out route", "hitch", "drag"],
  INTERMEDIATE: ["dig", "post", "comeback", "curl"],
  DEEP: ["go route", "deep post", "seam"],
};

// --- helpers ----------------------------------------------------------

function pick<T>(rng: Rng, rows: { w: number; item: T }[]): T {
  const total = rows.reduce((s, r) => s + r.w, 0);
  let r = rng.random() * total;
  for (const row of rows) {
    r -= row.w;
    if (r <= 0) return row.item;
  }
  return rows[rows.length - 1]!.item;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function playPhrase(ctx: InjuryPlayContext, onOffense: boolean, slot: string): string {
  const yд = Math.max(0, Math.round(ctx.gained));
  const isRun = ctx.call === "run" || ctx.outcome === "run" || ctx.outcome === "scramble";
  const onLine = /^(LT|LG|C|RG|RT)$/.test(slot);
  if (onOffense) {
    if (onLine) return isRun ? "blocking on a run" : "in pass protection";
    if (slot === "QB1") {
      if (ctx.outcome === "sack") return "being sacked";
      if (ctx.outcome === "interception") return "throwing a pass that was picked off";
      return isRun ? "scrambling out of the pocket" : "in the pocket";
    }
    if (isRun) {
      const dir = yд >= 8 ? "run to the outside" : "run up the middle";
      return yд <= 0 ? `on a ${dir}` : `on a ${yд}-yard ${dir}`;
    }
    if (ctx.outcome === "incomplete") return "reaching for an incompletion";
    if (ctx.outcome === "interception") return "on a pass that was intercepted";
    const routes = ROUTE_BY_DEPTH[ctx.depth] ?? ["route"];
    return yд <= 0 ? `catching a ${routes[0]}` : `completing a ${yд}-yard ${routes[0]}`;
  }
  // defense
  const dl = /^(EDGE|DT)/.test(slot);
  const lb = /^ILB/.test(slot);
  if (isRun) return dl ? "taking on a block against the run" : lb ? "filling a gap against the run" : "coming up to make a tackle";
  if (ctx.outcome === "sack") return "rushing the passer";
  if (dl) return "rushing the passer";
  if (lb) return "dropping into coverage";
  return ctx.depth === "DEEP" ? "defending a deep ball" : "breaking on a throw";
}

// --- the roll -------------------------------------------------------

/** ~per-play probability that *someone* suffers a game-affecting injury. */
export const INJURY_PER_PLAY = 0.0085;

/**
 * Decide who (if anyone) got hurt on the play just simulated and build the
 * event. The caller has already decided an injury occurs (rolled the hazard);
 * this only picks the victim + details.
 */
export function makeInjury(rng: Rng, ctx: InjuryPlayContext): InjuryEvent | null {
  // weight candidates: ball-handlers / trench players are likelier
  const onOffense = rng.random() < 0.52;
  const pool = onOffense ? ctx.offense : ctx.defense;
  const cands = pool.filter((c) => c.player) as { slot: string; player: Player }[];
  if (cands.length === 0) return null;

  const slotWeight = (slot: string): number => {
    if (onOffense) {
      if (/^(LT|LG|C|RG|RT)$/.test(slot)) return 3;
      if (slot === "RB1") return ctx.call === "run" ? 4 : 1.4;
      if (/^WR|^TE/.test(slot)) return ctx.call === "run" ? 1 : 2.4;
      if (slot === "QB1") return ctx.outcome === "sack" ? 3 : 0.8;
      return 1;
    }
    if (/^(EDGE|DT)/.test(slot)) return ctx.call === "run" ? 2.6 : 2.2;
    if (/^ILB/.test(slot)) return 2.4;
    if (/^CB|^S/.test(slot)) return ctx.call === "run" ? 1.4 : 2.4;
    return 1;
  };
  const chosen = pick(
    rng,
    cands.map((c) => ({ w: slotWeight(c.slot), item: c })),
  );
  const p = chosen.player;

  const group = POS_GROUP[p.position] ?? "SKILL";
  const bodyPart = pick(
    rng,
    (GROUP_BODY[group] ?? GROUP_BODY.SKILL!).map(([bp, w]) => ({ w, item: bp })),
  );
  const typeRow = pick(
    rng,
    (BODY_TYPES[bodyPart] ?? BODY_TYPES.knee!).map((t) => ({ w: t.w, item: t })),
  );

  const region = HEAD.has(bodyPart) ? "head" : LOWER.has(bodyPart) ? "lower" : "upper";
  const contactBase = ctx.call === "run" || ctx.outcome === "sack" ? 0.85 : region === "head" ? 0.85 : 0.6;
  const contact = rng.random() < contactBase;
  const opts =
    region === "head"
      ? contact
        ? HEAD_MECH_CONTACT
        : HEAD_MECH_NONCONTACT
      : contact
        ? MECH[region]!.contact
        : MECH[region]!.noncontact;
  const mechanism = pick(
    rng,
    opts.map((m) => ({ w: 1, item: m })),
  );
  const onPlay = playPhrase(ctx, onOffense, chosen.slot);

  const [lo, hi] = typeRow.weeks;
  const feared =
    region === "head"
      ? "He is in the concussion protocol"
      : typeRow.severity === "minor"
        ? `Believed to be a minor ${typeRow.type}`
        : typeRow.severity === "season"
          ? "Feared to be a torn ACL — likely done for the year"
          : `Exact injury unknown, but feared to be ${article(typeRow.type)} ${typeRow.type}`;
  const proj =
    typeRow.severity === "season"
      ? "Expected to miss the rest of the season"
      : hi <= 1
        ? "Considered day-to-day"
        : `Projected ${lo <= 1 ? 1 : lo}–${hi} weeks`;

  const narrative =
    region === "head"
      ? `${p.name} ${mechanism} while ${onPlay} and went to the medical tent. ${feared}. ${proj}.`
      : `${p.name}'s ${bodyPart} ${mechanism} while ${onPlay}. ${feared}. ${proj}.`;

  return {
    team: onOffense ? ctx.offenseTeam : ctx.defenseTeam,
    playerId: p.id,
    player: p.name,
    position: p.position,
    slot: chosen.slot,
    quarter: ctx.quarter,
    clock: ctx.clock,
    bodyPart,
    suspectedType: typeRow.type,
    severity: typeRow.severity,
    projectedWeeks: [lo > 20 ? 18 : lo, hi > 20 ? 18 : hi],
    mechanism,
    onPlay,
    narrative,
  };
}
