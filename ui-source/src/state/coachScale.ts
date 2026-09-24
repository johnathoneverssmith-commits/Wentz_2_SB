import type { Coach, LeagueState } from "@/domain";

/**
 * Coach ratings: the engine's scale and the franchise game's.
 *
 * The engine's coaching layer (`src/engine/staff.ts`) is calibrated on the
 * authored staffs, whose game management, discipline and play-calling sit in
 * a narrow ~44–66 band, with aggression and the pass/blitz tendencies as
 * small signed offsets. The franchise game shows coaches on the same 0–99
 * feel as players, so every value is mapped across once, here, by the same
 * order-preserving bands in both directions.
 *
 * It used to be mapped in one place only. The offline coach market banded
 * the engine values up to 55–95; the engine-backed market passed the raw
 * 44–66 straight through — so in any league created with the engine running,
 * every head coach and coordinator read as mediocre beside position coaches
 * on the 0–99 scale, and the CPU's coaching draft ranked them accordingly.
 * And nothing mapped them back, so the staff a GM drafted never reached a
 * game at all.
 */

interface Band {
  engine: [number, number];
  ui: [number, number];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function toUi(v: number, b: Band): number {
  const [e0, e1] = b.engine;
  const [u0, u1] = b.ui;
  return Math.round(clamp(u0 + ((v - e0) / (e1 - e0)) * (u1 - u0), Math.min(u0, u1), Math.max(u0, u1)));
}

function toEngine(v: number, b: Band): number {
  const [e0, e1] = b.engine;
  const [u0, u1] = b.ui;
  return e0 + ((clamp(v, Math.min(u0, u1), Math.max(u0, u1)) - u0) / (u1 - u0)) * (e1 - e0);
}

/** The bands the offline market always used; now the one definition. */
export const COACH_BANDS = {
  gameManagement: { engine: [44, 66], ui: [55, 95] },
  discipline: { engine: [44, 66], ui: [55, 95] },
  aggression: { engine: [0, 0.45], ui: [40, 95] },
  playCalling: { engine: [46, 66], ui: [55, 95] },
  passBias: { engine: [-0.05, 0.2], ui: [48, 68] },
  blitzBias: { engine: [0, 0.45], ui: [18, 42] },
} as const satisfies Record<string, Band>;

export type CoachBand = keyof typeof COACH_BANDS;

export const coachToUi = (key: CoachBand, engineValue: number): number => toUi(engineValue, COACH_BANDS[key]);
export const coachToEngine = (key: CoachBand, uiValue: number): number => toEngine(uiValue, COACH_BANDS[key]);

// ---- a franchise's staff, as the engine reads it -----------------------------


/** Structurally the engine's `Staff` (`src/engine/staff.ts`); kept local so
 *  the franchise layer does not import the engine. */
export interface EngineStaff {
  headCoach: { name: string; gameManagement: number; discipline: number; aggression: number };
  oc: { name: string; rating: number; scheme: string; passBias: number; tempo: number };
  dc: { name: string; rating: number; scheme: string; blitzBias: number };
}

/**
 * The HC, OC and DC a team actually employs, in the engine's units.
 *
 * The engine has a calibrated coaching layer — situational calls,
 * discipline, play-calling, scheme fit against the roster — and the franchise
 * game's coaching draft fills exactly those three jobs, but no game was ever
 * told who they were: every franchise game ran with no staff at all. A
 * vacancy plays as the engine's league-average coach (50 / 50 / no lean),
 * which is precisely zero effect, so a team is never penalised for a hole it
 * could not fill and never credited for one either.
 */
export function engineStaffFor(s: Pick<LeagueState, "coaches">, teamCode: string): EngineStaff {
  const on = (role: Coach["role"]): Coach | undefined =>
    Object.values(s.coaches).find((c) => c.team === teamCode && c.role === role);
  const hc = on("HC");
  const oc = on("OC");
  const dc = on("DC");
  return {
    headCoach: hc
      ? {
          name: hc.name,
          gameManagement: coachToEngine("gameManagement", hc.gameManagement ?? 75),
          discipline: coachToEngine("discipline", hc.discipline ?? 75),
          aggression: coachToEngine("aggression", hc.aggressiveness ?? 60),
        }
      : { name: "Interim HC", gameManagement: 50, discipline: 50, aggression: 0 },
    oc: oc
      ? {
          name: oc.name,
          rating: coachToEngine("playCalling", oc.playCallIq ?? 75),
          scheme: oc.scheme ?? "pro_style",
          passBias: coachToEngine("passBias", oc.tendencyPassRate ?? 58),
          tempo: 0,
        }
      : { name: "Interim OC", rating: 50, scheme: "pro_style", passBias: 0, tempo: 0 },
    dc: dc
      ? {
          name: dc.name,
          rating: coachToEngine("playCalling", dc.playCallIq ?? 75),
          scheme: dc.scheme ?? "multiple",
          blitzBias: coachToEngine("blitzBias", dc.tendencyBlitzRate ?? 30),
        }
      : { name: "Interim DC", rating: 50, scheme: "multiple", blitzBias: 0 },
  };
}

/** Every league team's staff, for a slate of games. */
export function engineStaffsFor(s: Pick<LeagueState, "coaches" | "teams">): Record<string, EngineStaff> {
  const out: Record<string, EngineStaff> = {};
  for (const code of Object.keys(s.teams)) out[code] = engineStaffFor(s, code);
  return out;
}
