/**
 * Position-group synergy — the part of a unit that is more than its average.
 *
 * ## The problem
 *
 * Every rating family in `ratings.ts` reads a unit through its *mean*. That is
 * the right model for what it was fitted to — the marginal effect of a better
 * unit, one real NFL roster against another — and it is exactly additive: five
 * great linemen are worth five times one great lineman, and one bad lineman
 * costs precisely his fifth of the average. Football does not work that way,
 * and it matters more here than in the data, because a fantasy draft lets a GM
 * build units no real team could afford.
 *
 *  - A line blocks as a line. Five good linemen pass stunts and double teams
 *    between them; four good ones and a turnstile give up the edge on every
 *    snap, because the rush goes where the weak man is.
 *  - Two great edge rushers cannot both be doubled. One great one can.
 *  - A great receiver is only as open as the ball is accurate, and a great
 *    quarterback is only as good as who is getting open.
 *
 * ## The interaction
 *
 * Everything here is built from one pairwise term over per-player skill
 * z-scores (standardised against the same reference pool the rating layer
 * uses):
 *
 *     J(a, b) = min(a, b) · |max(a, b)|
 *
 *   - both good          → positive, and superadditive: two +2s give +4, where
 *                          a +2 next to a 0 gives nothing
 *   - one good, one bad  → negative: the good player is dragged down by the
 *                          weak link, more the better he is
 *   - both bad           → negative, compounding
 *
 * A group's cohesion is a weighted mean of J over its pairs. Weights encode
 * which pairs actually work together — adjacent linemen, the two corners, the
 * two edges — so a hole next to the centre hurts more than one at the far end
 * of the formation.
 *
 * ## What it touches, and what it leaves alone
 *
 * The same three resolver channels the rating layer and the team-strength
 * index already move: completion (M09), sacks (M04) and rush yards (M14).
 * Nothing touches the scoreboard directly; better units win because they
 * complete more passes, give up fewer sacks and run further, and the score
 * follows from the football.
 *
 * Every term is **centred on the 32 reference depth charts**, exactly like the
 * rating layer's §12 offsets. An ordinary NFL roster — which has one or two
 * strong linemen and a couple of average ones — nets close to zero, so the
 * league averages the engine is validated against do not move. What changes
 * is the spread: units that are uniformly excellent, or that carry a real weak
 * link, now play like it.
 *
 * It is additive to the linear families, not a replacement. The linear part
 * is calibrated and stays calibrated; this is the curvature it cannot express.
 *
 * ## One channel that was missing outright
 *
 * `rushYardsShift` has always taken the offensive line as an argument and
 * ignored it — the fitted run model reads only the ball carrier and the front
 * seven. So the line had no effect on the run game at all, and a GM who
 * drafted five road-graders got nothing for it. `runBlockLinear` below is that
 * missing term, also centred, and the run-game synergies build on it.
 *
 * TS-only, like depth-chart ordering: there is no Python mirror, and every
 * validation path that runs pool-free (`simulateGame(seed)` with no rosters)
 * never reaches this file, so those stay byte-identical.
 */

import type { Player } from "../schema/player.js";
import { attributeZ, playerKey } from "./ratings.js";
import { type Lineup, roster, teamList } from "./roster.js";

// ---- per-player skill scores -------------------------------------------------

/**
 * A skill as attribute weights. Positive weights only: every entry is a thing
 * that makes the player better at this job, and the sign of each effect is
 * applied once, at the channel.
 */
type Skill = Readonly<Record<string, number>>;

const PASS_PRO: Skill = {
  pass_block: 0.4,
  pass_block_power: 0.2,
  pass_block_finesse: 0.2,
  anchor: 0.1,
  line_calls: 0.1,
};
const RUN_BLOCK: Skill = { run_block: 0.7, anchor: 0.15, line_calls: 0.15 };
const PASS_RUSH: Skill = {
  power_moves: 0.3,
  finesse_moves: 0.3,
  block_shedding: 0.2,
  play_recognition: 0.2,
};
const QB_PASS: Skill = {
  throw_accuracy_short: 0.35,
  throw_accuracy_mid: 0.35,
  throw_accuracy_deep: 0.2,
  awareness: 0.1,
};
const RECEIVING: Skill = {
  catching: 0.4,
  route_running_short: 0.2,
  route_running_mid: 0.2,
  route_running_deep: 0.1,
  release: 0.1,
};
const COVERAGE: Skill = {
  man_coverage: 0.35,
  zone_coverage: 0.35,
  press: 0.1,
  play_recognition: 0.2,
};
/** What a linebacker brings to the secondary. */
const LB_COVERAGE: Skill = { zone_coverage: 0.5, man_coverage: 0.3, play_recognition: 0.2 };
/** What a linebacker brings to the run fit. */
const LB_RUN: Skill = { tackle: 0.3, block_shedding: 0.25, pursuit: 0.25, play_recognition: 0.2 };
const DL_RUN: Skill = { run_defense: 0.4, block_shedding: 0.3, tackle: 0.15, pursuit: 0.15 };
/** Playing the ball in the air: what turns a defended pass into a pick. */
const BALL_HAWK: Skill = {
  play_recognition: 0.35,
  zone_coverage: 0.2,
  man_coverage: 0.15,
  jumping: 0.15,
  awareness: 0.15,
};
/** Bringing a ball carrier down. */
const TACKLING: Skill = { tackle: 0.5, pursuit: 0.3, play_recognition: 0.2 };
/** Taking the ball away in a tackle. */
const STRIP: Skill = { hit_power: 0.5, tackle: 0.3, strength: 0.2 };

/**
 * How much a defender's skill at a job should tilt who gets credit for it —
 * the sack, the pick, the breakup, the tackle, the forced fumble.
 *
 * Credit used to be a fixed share by depth-chart slot: an elite corner and a
 * poor one beside him split the secondary's interceptions evenly, and a
 * pass rush that forced bad throws handed the picks out at random. This is a
 * multiplier on that slot share, from the player's skill z-score; it never
 * changes what happens on a play, only whose line it goes on.
 */
export type CreditKind = "sack" | "interception" | "breakup" | "tackle" | "strip";
const CREDIT: Record<CreditKind, [Skill, number]> = {
  sack: [PASS_RUSH, 0.3],
  interception: [BALL_HAWK, 0.3],
  breakup: [COVERAGE, 0.25],
  tackle: [TACKLING, 0.15],
  strip: [STRIP, 0.3],
};
export function creditWeight(p: Player | null | undefined, kind: CreditKind): number {
  const [skill, k] = CREDIT[kind];
  const z = skillZ(p, skill);
  if (z === null || !p) return 1;
  // against his own position's starters, not the league: the slot shares
  // already say a linebacker makes more tackles than a corner, and a
  // league-wide z said it again — the leaders ran to 238 tackles and 49
  // passes defended
  const rel = z - (positionMeanZ(kind).get(p.position) ?? 0);
  return Math.exp(k * Math.max(-2, Math.min(2, rel)));
}

const _posMean = new Map<CreditKind, Map<string, number>>();
/** Mean skill z of the reference depth charts' starters (top two), by position. */
function positionMeanZ(kind: CreditKind): Map<string, number> {
  let m = _posMean.get(kind);
  if (m) return m;
  const sums = new Map<string, [number, number]>();
  for (const t of teamList()) {
    for (const [pos, list] of roster(t).depth) {
      for (const p of list.slice(0, 2)) {
        const z = skillZ(p, CREDIT[kind][0]);
        if (z === null) continue;
        const s = sums.get(pos) ?? [0, 0];
        sums.set(pos, [s[0] + z, s[1] + 1]);
      }
    }
  }
  m = new Map([...sums].map(([pos, [s, n]]) => [pos, s / n]));
  _posMean.set(kind, m);
  return m;
}

const RUNNER: Skill = {
  ball_carrier_vision: 0.35,
  break_tackle: 0.25,
  speed: 0.2,
  acceleration: 0.2,
};

/** One player's score at one skill, as a weighted mean of attribute z-scores. */
function skillZ(p: Player | null | undefined, skill: Skill): number | null {
  if (!p) return null;
  let num = 0;
  let den = 0;
  for (const [attr, w] of Object.entries(skill)) {
    const v = p.attributes?.[attr as keyof Player["attributes"]];
    if (typeof v !== "number") continue;
    const z = attributeZ(attr, v);
    if (z === null) continue;
    num += w * z;
    den += w;
  }
  return den > 0 ? num / den : null;
}

// ---- the interaction ------------------------------------------------------

/** The pairwise synergy term. See the module comment. */
export function pairJ(a: number, b: number): number {
  return Math.min(a, b) * Math.abs(Math.max(a, b));
}

/** A member of a group: a slot's player, and how much his pairs count. */
interface Member {
  z: number | null;
  /** Scales every pair this player is in. */
  w: number;
}

/**
 * Weighted mean of `J` over every pair in the group. `pairWeight` lets a
 * caller up-weight the pairs that actually work together.
 */
function cohesion(members: Member[], pairWeight: (i: number, j: number) => number = () => 1): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < members.length; i++) {
    const a = members[i]!;
    if (a.z === null) continue;
    for (let j = i + 1; j < members.length; j++) {
      const b = members[j]!;
      if (b.z === null) continue;
      const w = a.w * b.w * pairWeight(i, j);
      num += w * pairJ(a.z, b.z);
      den += w;
    }
  }
  return den > 0 ? num / den : 0;
}

/** Weighted mean skill of a group, for the cross-unit interactions. */
function meanZ(members: Member[]): number | null {
  let num = 0;
  let den = 0;
  for (const m of members) {
    if (m.z === null) continue;
    num += m.w * m.z;
    den += m.w;
  }
  return den > 0 ? num / den : null;
}

const cross = (a: number | null, b: number | null): number => (a === null || b === null ? 0 : pairJ(a, b));

// ---- unit scores ------------------------------------------------------------

/** LT, LG, C, RG, RT: a pair of neighbours blocks together, so it counts double. */
const OL_SLOTS = ["LT", "LG", "C", "RG", "RT"] as const;
const olAdjacent = (i: number, j: number): number => (Math.abs(i - j) === 1 ? 2 : 1);

/**
 * Raw (uncentred) synergy scores for one offense against one defense.
 *
 * Offensive terms read only the offense and defensive terms only the defense;
 * the pairing happens at the channel. Every term is in z² units except
 * `runBlockLinear`, which is a plain mean z.
 */
export interface UnitScores {
  /** OL pass-protection cohesion. */
  passPro: number;
  /** OL (and TE) run-blocking cohesion. */
  runBlock: number;
  /** The line's run blocking at all — the channel the fitted model lacks. */
  runBlockLinear: number;
  /** Ball carrier × the line in front of him. */
  runnerLine: number;
  /** Quarterback × the receivers he is throwing to. */
  qbReceivers: number;
  /** Edge pair, interior pair, and the two working together. */
  passRush: number;
  /** Corners and safeties covering as one. */
  secondary: number;
  /** Linebackers who can cover × the secondary they are helping. */
  lbCoverage: number;
  /** Front four run defense, as a unit. */
  dlRun: number;
  /** Linebackers who fit the run × the front in front of them. */
  lbRun: number;
  /** Pressure × coverage: each makes the other work. */
  rushCoverage: number;
  /**
   * This defence's rush against this offence's protection — the one term
   * that reads both teams. See `pressureMatchup`.
   */
  pressure: number;
}

function offenseScores(o: Lineup): Pick<UnitScores, "passPro" | "runBlock" | "runBlockLinear" | "runnerLine" | "qbReceivers"> {
  const pro: Member[] = OL_SLOTS.map((s) => ({ z: skillZ(o[s], PASS_PRO), w: 1 }));
  // the tight end is a sixth blocker on a run, but only half of one
  const run: Member[] = [
    ...OL_SLOTS.map((s) => ({ z: skillZ(o[s], RUN_BLOCK), w: 1 })),
    { z: skillZ(o.TE1, RUN_BLOCK), w: 0.5 },
  ];
  const runLine = meanZ(run);
  const runner = skillZ(o.RB1, RUNNER);

  const qb = skillZ(o.QB1, QB_PASS);
  // Each target is its own quarterback–receiver pair, weighted by how often
  // the ball goes his way. Pairing the quarterback with the receivers' *mean*
  // diluted the one relationship that matters most: a bad WR1 next to two
  // decent receivers barely moved it, so a great quarterback lost almost
  // nothing throwing to him.
  const targets: [Player | null | undefined, number][] = [
    [o.WR1, 1],
    [o.WR2, 0.7],
    [o.WR3, 0.45],
    [o.TE1, 0.55],
  ];
  let qbNum = 0;
  let qbDen = 0;
  for (const [p, w] of targets) {
    const z = skillZ(p, RECEIVING);
    if (qb === null || z === null) continue;
    qbNum += w * pairJ(qb, z);
    qbDen += w;
  }

  return {
    passPro: cohesion(pro, olAdjacent),
    // the TE (index 5) sits next to the right tackle (index 4)
    runBlock: cohesion(run, (i, j) => (Math.abs(i - j) === 1 ? 2 : 1)),
    runBlockLinear: runLine ?? 0,
    runnerLine: cross(runner, runLine),
    qbReceivers: qbDen > 0 ? qbNum / qbDen : 0,
  };
}

function defenseScores(d: Lineup): Omit<UnitScores, "passPro" | "runBlock" | "runBlockLinear" | "runnerLine" | "qbReceivers" | "pressure"> {
  // EDGE1, EDGE2, DT1, DT2. The edge pair is the one that decides whether a
  // protection can slide to a single rusher, so it dominates.
  const rush: Member[] = [
    { z: skillZ(d.EDGE1, PASS_RUSH), w: 1 },
    { z: skillZ(d.EDGE2, PASS_RUSH), w: 1 },
    { z: skillZ(d.DT1, PASS_RUSH), w: 1 },
    { z: skillZ(d.DT2, PASS_RUSH), w: 1 },
  ];
  // Not a mean over the six pairs. Averaged, a line of four stars compounded
  // six ways and forced sacks on 18% of dropbacks — half again the best
  // defence on record. The edge pair is the relationship that decides whether
  // a protection can slide to one rusher; the interior pair and the
  // edge-interior crosses are real but secondary.
  const [e1, e2, d1, d2] = rush.map((m) => m.z);
  const pj = (a: number | null | undefined, b: number | null | undefined): number =>
    a == null || b == null ? 0 : pairJ(a, b);
  const crosses = [pj(e1, d1), pj(e1, d2), pj(e2, d1), pj(e2, d2)];
  const passRush =
    pj(e1, e2) + 0.15 * pj(d1, d2) + 0.05 * (crosses.reduce((a, b) => a + b, 0) / crosses.length);

  const dbs: Member[] = [
    { z: skillZ(d.CB1, COVERAGE), w: 1 },
    { z: skillZ(d.CB2, COVERAGE), w: 1 },
    { z: skillZ(d.S1, COVERAGE), w: 1 },
    { z: skillZ(d.S2, COVERAGE), w: 1 },
  ];
  if (d.CB3 !== undefined) dbs.push({ z: skillZ(d.CB3, COVERAGE), w: 0.7 });
  // the two corners are the pair a passing game attacks
  const dbWeight = (i: number, j: number): number => (i === 0 && j === 1 ? 2 : 1);

  const lbs = [d.ILB1, d.ILB2].filter((p) => p !== undefined);
  const lbCov = meanZ(lbs.map((p) => ({ z: skillZ(p, LB_COVERAGE), w: 1 })));
  const lbRun = meanZ(lbs.map((p) => ({ z: skillZ(p, LB_RUN), w: 1 })));

  const front: Member[] = [d.EDGE1, d.EDGE2, d.DT1, d.DT2].map((p) => ({ z: skillZ(p, DL_RUN), w: 1 }));

  const rushMean = meanZ(rush.map((m, i) => ({ z: m.z, w: i < 2 ? 1.5 : 1 })));
  const dbMean = meanZ(dbs);

  return {
    passRush,
    secondary: cohesion(dbs, dbWeight),
    lbCoverage: cross(lbCov, dbMean),
    dlRun: cohesion(front),
    lbRun: cross(lbRun, meanZ(front)),
    rushCoverage: cross(rushMean, dbMean),
  };
}

// ---- the matchup -----------------------------------------------------------

/**
 * One team's pass rush against the other's protection.
 *
 * Every other term reads one unit, and the sack channel simply added the
 * offense's line to the defense's rush — so a great rush against a bad line
 * was exactly as bad for the quarterback as the two gaps summed, and pressure
 * never reached anything but the sack rate. Real pressure compounds against a
 * line that can't hold it, and it is why the passes that do get off are
 * hurried: fewer complete, more are picked.
 *
 * The line is valued the way a rush attacks it — its average, pulled hard
 * toward its weakest man — and the rush by its edges first. The pairing is
 * the same `J`, on (rush, −line): a stellar rush against a bad line is both
 * sides "good for the defence" and superadditive; a bad rush against a great
 * line runs the other way, and the quarterback gets a clean pocket.
 */
function pressureRaw(o: Lineup, d: Lineup): number {
  const line = OL_SLOTS.map((s) => skillZ(o[s], PASS_PRO)).filter((z): z is number => z !== null);
  const rushers: [Player | null | undefined, number][] = [
    [d.EDGE1, 0.35],
    [d.EDGE2, 0.35],
    [d.DT1, 0.15],
    [d.DT2, 0.15],
  ];
  let num = 0;
  let den = 0;
  for (const [p, w] of rushers) {
    const z = skillZ(p, PASS_RUSH);
    if (z === null) continue;
    num += w * z;
    den += w;
  }
  if (line.length === 0 || den === 0) return 0;
  const lineMean = line.reduce((a, b) => a + b, 0) / line.length;
  const lineZ = 0.6 * lineMean + 0.4 * Math.min(...line);
  return pairJ(num / den, -lineZ);
}

let _pressureRef: number | null = null;
/** Mean over every ordered pair of reference teams — offense of one, defense of another. */
function pressureReference(): number {
  if (_pressureRef !== null) return _pressureRef;
  const teams = teamList();
  let sum = 0;
  let n = 0;
  for (const a of teams) {
    for (const b of teams) {
      if (a === b) continue;
      sum += pressureRaw(roster(a).offense(), roster(b).defense());
      n++;
    }
  }
  _pressureRef = n ? sum / n : 0;
  return _pressureRef;
}

const _pressureCache = new Map<string, number>();
function cachedPressure(o: Lineup, d: Lineup): number {
  const k = `${keyOf(o)}|${keyOf(d)}`;
  let v = _pressureCache.get(k);
  if (v === undefined) {
    v = pressureRaw(o, d);
    if (_pressureCache.size > 20_000) _pressureCache.clear();
    _pressureCache.set(k, v);
  }
  return v;
}

// ---- centring -----------------------------------------------------------------

let _reference: UnitScores | null = null;

/**
 * Mean of every score over the 32 reference depth charts — the §12 treatment
 * the rating layer gives its own families, and for the same reason: the
 * engine is validated on those rosters, so an ordinary one of them has to net
 * zero here.
 */
export function referenceScores(): UnitScores {
  if (_reference) return _reference;
  const teams = teamList();
  const sum: Record<string, number> = {};
  for (const t of teams) {
    const r = roster(t);
    const s = { ...offenseScores(r.offense()), ...defenseScores(r.defense()) };
    for (const [k, v] of Object.entries(s)) sum[k] = (sum[k] ?? 0) + v;
  }
  const out = {} as Record<string, number>;
  for (const [k, v] of Object.entries(sum)) out[k] = v / teams.length;
  out.pressure = pressureReference();
  _reference = out as unknown as UnitScores;
  return _reference;
}

/** Keyed by the players on the field, because injuries and nickel change it. */
const _offCache = new Map<string, ReturnType<typeof offenseScores>>();
const _defCache = new Map<string, ReturnType<typeof defenseScores>>();
const keyOf = (l: Lineup): string =>
  Object.entries(l)
    .map(([slot, p]) => `${slot}:${playerKey(p)}`)
    .join(",");

function cachedOffense(o: Lineup): ReturnType<typeof offenseScores> {
  const k = keyOf(o);
  let v = _offCache.get(k);
  if (!v) {
    v = offenseScores(o);
    if (_offCache.size > 20_000) _offCache.clear();
    _offCache.set(k, v);
  }
  return v;
}
function cachedDefense(d: Lineup): ReturnType<typeof defenseScores> {
  const k = keyOf(d);
  let v = _defCache.get(k);
  if (!v) {
    v = defenseScores(d);
    if (_defCache.size > 20_000) _defCache.clear();
    _defCache.set(k, v);
  }
  return v;
}

/** Centred scores for this offense against this defense. */
export function unitScores(o: Lineup, d: Lineup): UnitScores {
  const ref = referenceScores();
  const raw = { ...cachedOffense(o), ...cachedDefense(d), pressure: cachedPressure(o, d) };
  const out = {} as Record<string, number>;
  for (const [k, v] of Object.entries(raw)) out[k] = v - (ref[k as keyof UnitScores] ?? 0);
  return out as unknown as UnitScores;
}

// ---- channels ---------------------------------------------------------------

/**
 * Per-unit channel weights. Signs are from the offense's point of view.
 * Calibrated in `analysis/33_synergy.ts` — see `docs/decisions.md` → Synergy
 * for the targets and what they measured.
 */
export const SYNERGY_WEIGHTS = {
  complete: {
    qbReceivers: 0.085,
    secondary: -0.02,
    lbCoverage: -0.004,
    rushCoverage: -0.02,
    pressure: -0.035,
  },
  sack: { passPro: -0.1, passRush: 0.042, rushCoverage: 0.03, pressure: 0.05 },
  interception: { pressure: 0.045 },
  rushYards: {
    runBlockLinear: 0.11,
    runBlock: 0.06,
    runnerLine: 0.015,
    dlRun: -0.06,
    lbRun: -0.05,
  },
} as const;

/**
 * Multiplies every synergy shift. One, and left as a knob for the same reason
 * `TEAM_STRENGTH_SCALE` is: the per-channel weights are the calibration, and a
 * single lever makes the next refit — or an A/B in the analysis harness — a
 * one-line change rather than eleven.
 */
let synergyScale = 1;
export function getSynergyScale(): number {
  return synergyScale;
}
/** Analysis only: turn synergy down, off, or up for a comparison run. */
export function setSynergyScale(v: number): void {
  synergyScale = v;
}

type Channel = keyof typeof SYNERGY_WEIGHTS;

/**
 * How far synergy alone can move each channel, as a soft ceiling.
 *
 * The pairwise term compounds without limit, which is right in the middle of
 * the range and wrong at the ends: the five worst linemen in the pool
 * against the two best edge rushers gave up a sack on 43% of dropbacks, where
 * the worst real protection on record is around 12–13%. `tanh` leaves an
 * ordinary shift almost untouched and bends an extreme one toward the
 * ceiling, so the worst matchups are as bad as real football gets and no
 * worse. Logits for the rate channels, yards per carry for the run game.
 */
const SATURATION: Record<Channel, number> = {
  complete: 0.55,
  sack: 0.75,
  interception: 0.6,
  rushYards: 1.4,
};

const SACK_CEILING_UP = 0.5;

/** The synergy shift on one channel, for this offense against this defense. */
export function synergyShift(o: Lineup, d: Lineup, channel: Channel): number {
  if (synergyScale === 0) return 0;
  const s = unitScores(o, d);
  let total = 0;
  for (const [k, w] of Object.entries(SYNERGY_WEIGHTS[channel])) {
    total += (s[k as keyof UnitScores] ?? 0) * (w as number);
  }
  // Asymmetric for sacks: more room below (a great line) than above. The
  // linear model already carries a bad line close to the worst real sack
  // rates, so synergy adds less on top there before reality runs out.
  const cap = channel === "sack" && total > 0 ? SACK_CEILING_UP : SATURATION[channel];
  return cap * Math.tanh((total * synergyScale) / cap);
}

// ---- the blitz ----------------------------------------------------------------

/**
 * What a blitz is sending into, as z-scores against the reference lineups
 * (clamped to ±2): the coverage left behind it, the protection it is
 * attacking, and the quarterback who has to beat it.
 *
 * A coordinator's blitz bias was a flat trade — more sacks, more completions
 * when it is beaten — whatever the personnel. In football it depends on them:
 * blitzing in front of corners who can hold up alone is how a defense gets
 * home, blitzing in front of bad ones is how it gives up the big play, and a
 * great quarterback behind a great line is the one man you do not send
 * pressure at.
 */
/**
 * How good a player is at one thing the heavy personnel groups ask of a tight
 * end, as a z-score against the league (clamped to +-2; 0 when the attributes
 * aren't there): run blocking, and catching and running routes.
 */
export function blockingZ(p: Player | null | undefined): number {
  const z = skillZ(p, RUN_BLOCK);
  return z === null ? 0 : Math.max(-2, Math.min(2, z));
}
export function receivingZ(p: Player | null | undefined): number {
  const z = skillZ(p, RECEIVING);
  return z === null ? 0 : Math.max(-2, Math.min(2, z));
}

/**
 * How well an offense is built to pass and to run, as z-scores against the
 * league (clamped): the quarterback, the receivers and the protection for the
 * one; the back, the line's run blocking and the tight ends' for the other. A
 * game plan that leans on either is only as good as this.
 */
const RUNNER_GRADE: Skill = { ball_carrier_vision: 0.35, break_tackle: 0.25, speed: 0.2, acceleration: 0.2 };
export function styleGrades(o: Lineup): { pass: number; run: number } {
  const clamp = (x: number | null) => (x === null ? 0 : Math.max(-2, Math.min(2, x)));
  const qb = clamp(skillZ(o.QB1, QB_PASS));
  const recv = clamp(meanSkill([o.WR1, o.WR2, o.WR3, o.TE1], RECEIVING));
  const pro = clamp(meanSkill([o.LT, o.LG, o.C, o.RG, o.RT], PASS_PRO));
  const back = clamp(skillZ(o.RB1, RUNNER_GRADE));
  const blocking = clamp(meanSkill([o.LT, o.LG, o.C, o.RG, o.RT], RUN_BLOCK));
  const te = clamp(skillZ(o.TE1, RUN_BLOCK));
  return { pass: 0.45 * qb + 0.35 * recv + 0.2 * pro, run: 0.35 * back + 0.5 * blocking + 0.15 * te };
}

/**
 * How athletic a quarterback is, as a z-score against the league's
 * quarterbacks (clamped to +-2): Lamar Jackson ~ +1.8, Kirk Cousins ~ -1.6.
 * Speed, burst and agility, the legs a scramble or a keeper runs on.
 */
export function qbMobilityZ(p: Player | null | undefined): number {
  const a = p?.attributes;
  if (!a) return 0;
  const parts: [number | undefined, number][] = [[a.speed, 0.4], [a.acceleration, 0.3], [a.agility, 0.3]];
  let num = 0;
  let den = 0;
  for (const [v, w] of parts) {
    if (typeof v !== "number") continue;
    num += v * w;
    den += w;
  }
  return den > 0 ? Math.max(-2, Math.min(2, (num / den - 77) / 9)) : 0;
}

/** How dangerous a man is with the ball in space (a returner), z against the league (clamped to +-2). */
export function returnerZ(p: Player | null | undefined): number {
  const z = skillZ(p, { speed: 0.4, acceleration: 0.3, agility: 0.3 });
  return z === null ? 0 : Math.max(-2, Math.min(2, z));
}

/** A kicker's leg, z against the league (clamped to +-2). */
export function kickerLegZ(p: Player | null | undefined): number {
  const z = skillZ(p, { kick_power: 1 });
  return z === null ? 0 : Math.max(-2, Math.min(2, z));
}

export interface BlitzContext {
  /** corners and safeties left in coverage */
  coverage: number;
  /** the linebackers who rush or drop */
  linebackers: number;
  /** the defensive line that gets there */
  rush: number;
  protection: number;
  quarterback: number;
}

/**
 * What a blitz is worth *because of who is sending it and who it is sent at*,
 * per unit of blitz (the flat trade, more sacks and more big plays, is the
 * caller's). The front four decide whether pressure arrives (a blitz from a
 * line that can't win a one-on-one is five rushers losing), the linebackers
 * are who actually comes and who drops, and the corners and safeties are what
 * the pressure's hot throws land on. The line is the largest share, as it is
 * in the game: 40% line, 30% linebackers, 30% secondary.
 */
export function blitzEffect(bz: BlitzContext): { sack: number; complete: number } {
  const send = 0.4 * bz.rush + 0.3 * bz.linebackers + 0.3 * bz.coverage;
  return {
    sack: 0.4 * send - 0.1 * bz.protection - 0.06 * bz.quarterback,
    complete: -0.12 * send + 0.06 * bz.quarterback + 0.04 * bz.protection,
  };
}
const meanSkill = (ps: (Player | null | undefined)[], skill: Skill): number | null => {
  const zs = ps.map((p) => skillZ(p, skill)).filter((z): z is number => z !== null);
  return zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
};
const blitzRaw = (o: Lineup, d: Lineup) => ({
  coverage: meanSkill([d.CB1, d.CB2, d.S1, d.S2], COVERAGE),
  linebackers: meanSkill([d.ILB1, d.ILB2], LB_COVERAGE),
  rush: meanSkill([d.EDGE1, d.EDGE2, d.DT1, d.DT2], PASS_RUSH),
  protection: meanSkill([o.LT, o.LG, o.C, o.RG, o.RT], PASS_PRO),
  quarterback: meanSkill([o.QB1], QB_PASS),
});
let _blitzRef: { mean: Record<keyof BlitzContext, number>; sd: Record<keyof BlitzContext, number> } | null = null;
function blitzReference() {
  if (_blitzRef) return _blitzRef;
  const rows = teamList().map((t) => blitzRaw(roster(t).offense(), roster(t).defense()));
  const keys = ["coverage", "linebackers", "rush", "protection", "quarterback"] as const;
  const mean = {} as Record<keyof BlitzContext, number>;
  const sd = {} as Record<keyof BlitzContext, number>;
  for (const k of keys) {
    const xs = rows.map((r) => r[k]).filter((x): x is number => x !== null);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    mean[k] = m;
    sd[k] = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
  }
  return (_blitzRef = { mean, sd });
}
export function blitzContext(o: Lineup, d: Lineup): BlitzContext {
  const ref = blitzReference();
  const raw = blitzRaw(o, d);
  const z = (k: keyof BlitzContext) => {
    const v = raw[k];
    return v === null ? 0 : Math.max(-2, Math.min(2, (v - ref.mean[k]) / ref.sd[k]));
  };
  return {
    coverage: z("coverage"),
    linebackers: z("linebackers"),
    rush: z("rush"),
    protection: z("protection"),
    quarterback: z("quarterback"),
  };
}
