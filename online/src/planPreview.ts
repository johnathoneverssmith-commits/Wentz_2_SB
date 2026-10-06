import { cleanPlan, type GamePlan } from "../../src/engine/gameplan.js";
import { previewPlan, type PlanPreview } from "../../src/engine/plan-preview.js";
import { Roster } from "../../src/engine/roster.js";
import { weatherFor } from "../../src/engine/weather.js";
import type { Player as EnginePlayer } from "../../src/schema/player.js";

import type { LeagueState } from "@/domain";
import { availableRoster } from "@/state/injuries.ts";
import { previewOpponent } from "@/state/planPreview.ts";
import { talentScaleOf } from "@/state/talentImpact.ts";

import { toEngine, withPlaceholders } from "./blocks.js";
import { planPairOf, staffPairOf } from "./staffs.js";

/** Everything a preview needs, as plain data — it crosses to the simulation worker. */
export interface PreviewInput {
  seedBase: number;
  home: string;
  away: string;
  side: "home" | "away";
  plan: GamePlan;
  games: number;
  homePlayers: unknown[];
  awayPlayers: unknown[];
  homeDepth: Record<string, readonly string[]> | undefined;
  awayDepth: Record<string, readonly string[]> | undefined;
  options: Record<string, unknown>;
}


/** The preview's inputs, built the way a block builds a game. */
export function previewInput(state: LeagueState, team: string, plan: unknown, watchedPre: number, games = 160): { input: PreviewInput; label: string; opponent: string } | null {
  const next = previewOpponent(state, team, watchedPre);
  if (!next) return null;
  const [home, away] = next.home ? [team, next.opponent] : [next.opponent, team];
  const squad = (code: string) =>
    withPlaceholders(state, code, availableRoster(Object.values(state.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent)));
  const pair = planPairOf(state, home, away);
  const seedBase = [...`${state.season}|${home}|${away}|preview`].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
  return {
    opponent: next.opponent,
    label: next.label,
    input: {
      seedBase,
      home: toEngine(home),
      away: toEngine(away),
      side: next.home ? "home" : "away",
      plan: cleanPlan(plan as Partial<GamePlan>),
      games,
      homePlayers: squad(home),
      awayPlayers: squad(away),
      homeDepth: state.depthChart[home] as Record<string, readonly string[]> | undefined,
      awayDepth: state.depthChart[away] as Record<string, readonly string[]> | undefined,
      options: {
        talentScale: talentScaleOf(state.config),
        offenseAdjust: state.offenseAdjust ?? 0,
        overtime: "nfl",
        weather: weatherFor(toEngine(home), next.phase, next.week, seedBase),
        ...staffPairOf(state, home, away),
        // the opponent plays the plan it really plays
        homePlan: pair.homePlan,
        awayPlan: pair.awayPlan,
      },
    },
  };
}

/** Plays a preview (in the worker, or here). */
export function runPreview(i: PreviewInput): PlanPreview {
  const homeRoster = new Roster(i.home, i.homePlayers as EnginePlayer[], i.homeDepth);
  const awayRoster = new Roster(i.away, i.awayPlayers as EnginePlayer[], i.awayDepth);
  return previewPlan(i.seedBase, i.home, i.away, { ...i.options, homeRoster, awayRoster } as never, i.side, i.plan, i.games);
}
