/**
 * Save / load for the stateful engine loops (Phase A1).
 *
 * `SeasonProgress` and `PlayoffProgress` are already plain JSON (no Maps, no
 * class instances), so persistence is mostly a version tag + a shape check on
 * the way back in so a corrupt or stale save fails loudly instead of blowing up
 * mid-render. `priorRank` is the one `Map` in the option bags — `priorRankToObj`
 * / `priorRankFromObj` bridge it.
 */

import type { PlayoffProgress } from "./playoffs.js";
import type { SeasonProgress } from "./season.js";

export const SAVE_VERSION = 1;

interface Envelope<T> {
  v: number;
  kind: "season" | "playoffs";
  data: T;
}

function parseEnvelope<T>(json: string, kind: Envelope<T>["kind"]): T {
  let env: unknown;
  try {
    env = JSON.parse(json);
  } catch {
    throw new Error("deserialize: not valid JSON");
  }
  if (typeof env !== "object" || env === null) throw new Error("deserialize: not an object");
  const e = env as Partial<Envelope<T>>;
  if (e.v !== SAVE_VERSION) throw new Error(`deserialize: save version ${e.v} != ${SAVE_VERSION}`);
  if (e.kind !== kind) throw new Error(`deserialize: expected a ${kind} save, got ${e.kind}`);
  if (e.data === undefined) throw new Error("deserialize: missing data");
  return e.data;
}

// --- season ---

export function serializeSeason(p: SeasonProgress): string {
  const env: Envelope<SeasonProgress> = { v: SAVE_VERSION, kind: "season", data: p };
  return JSON.stringify(env);
}

export function deserializeSeason(json: string): SeasonProgress {
  const p = parseEnvelope<SeasonProgress>(json, "season");
  if (
    typeof p.seed !== "number" ||
    typeof p.year !== "number" ||
    !Array.isArray(p.schedule) ||
    !Array.isArray(p.results) ||
    typeof p.nextWeek !== "number"
  ) {
    throw new Error("deserialize: malformed SeasonProgress");
  }
  if (p.schedule.length !== 272) {
    throw new Error(`deserialize: schedule has ${p.schedule.length} games, expected 272`);
  }
  if (p.nextWeek < 1 || p.nextWeek > 19) {
    throw new Error(`deserialize: nextWeek ${p.nextWeek} out of range`);
  }
  const expectedPlayed = p.schedule.filter((g) => g.week < p.nextWeek).length;
  if (p.results.length !== expectedPlayed) {
    throw new Error(
      `deserialize: ${p.results.length} results but weeks 1–${p.nextWeek - 1} hold ${expectedPlayed} games`,
    );
  }
  return p;
}

// --- playoffs ---

export function serializePlayoffs(p: PlayoffProgress): string {
  const env: Envelope<PlayoffProgress> = { v: SAVE_VERSION, kind: "playoffs", data: p };
  return JSON.stringify(env);
}

export function deserializePlayoffs(json: string): PlayoffProgress {
  const p = parseEnvelope<PlayoffProgress>(json, "playoffs");
  const rounds = ["wildcard", "divisional", "conference", "superbowl", "done"];
  if (
    typeof p.seed !== "number" ||
    !p.seeding ||
    !rounds.includes(p.nextRound) ||
    !Array.isArray(p.games) ||
    !p.alive?.AFC ||
    !p.alive?.NFC
  ) {
    throw new Error("deserialize: malformed PlayoffProgress");
  }
  return p;
}

// --- priorRank Map bridge ---

export function priorRankToObj(m: Map<string, number>): Record<string, number> {
  return Object.fromEntries(m);
}

export function priorRankFromObj(o: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(o));
}
