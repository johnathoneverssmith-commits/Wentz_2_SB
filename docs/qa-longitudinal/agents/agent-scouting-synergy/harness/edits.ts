/** Attribute edits for Experiments A and D, in z-units of the rating layer (attribute-specific sd), shared with diag_fit.ts. */
import { ratings } from "./lib.ts";
export const bump = (p: any, d: Record<string, number>) => {
  for (const [k, dz] of Object.entries(d)) {
    const v = p.attributes?.[k]; if (typeof v !== "number") continue;
    const z0 = ratings.attributeZ(k, v), z1 = ratings.attributeZ(k, v + 1);
    if (z0 === null || z1 === null || z1 === z0) continue;
    p.attributes[k] = Math.max(20, Math.min(99, Math.round(v + dz / (z1 - z0))));
  }
};
export const Q = 0.8;                                   // quality bump (z)
export const SZ = Number(process.env.STYLE_DZ ?? 0.5);  // half-width of a style edit (z): plus group +SZ, minus group -SZ
export const grp = (keys: string[], v: number): Record<string, number> => Object.fromEntries(keys.map((k) => [k, v]));
export const sum = (...o: Record<string, number>[]): Record<string, number> => { const r: Record<string, number> = {}; for (const x of o) for (const [k, v] of Object.entries(x)) r[k] = (r[k] ?? 0) + v; return r; };
export const RB_PLUS = ["ball_carrier_vision", "agility", "juke_move", "acceleration"], RB_MINUS = ["break_tackle", "stiff_arm", "strength"];
export const OL_PLUS = ["agility", "acceleration", "speed"], OL_MINUS = ["strength", "anchor", "pass_block_power"];
export const QB_PLUS = ["throw_accuracy_deep", "throw_power"], QB_MINUS = ["throw_accuracy_short", "awareness"];
export const WR_PLUS = ["route_running_deep", "speed", "acceleration"], WR_MINUS = ["route_running_short", "catching", "release"];
export const RUN_Q = grp(["ball_carrier_vision", "break_tackle", "speed", "acceleration"], Q);
export const OL_Q = grp(["run_block", "anchor", "line_calls"], Q);
export const RB_E = sum(grp(RB_PLUS, SZ), grp(RB_MINUS, -SZ)), RB_P = sum(grp(RB_PLUS, -SZ), grp(RB_MINUS, SZ));
export const OL_M = sum(grp(OL_PLUS, SZ), grp(OL_MINUS, -SZ)), OL_Dv = sum(grp(OL_PLUS, -SZ), grp(OL_MINUS, SZ));
export const QB_V = sum(grp(QB_PLUS, SZ), grp(QB_MINUS, -SZ)), QB_K = sum(grp(QB_PLUS, -SZ), grp(QB_MINUS, SZ));
export const WR_V = sum(grp(WR_PLUS, SZ), grp(WR_MINUS, -SZ)), WR_T = sum(grp(WR_PLUS, -SZ), grp(WR_MINUS, SZ));
/** style-neutral quality bumps: both style groups rise by the same z, so the style axis does not move */
export const RUN_QN = grp([...RB_PLUS, ...RB_MINUS, "speed"], Q);
export const OL_QN = grp([...OL_PLUS, ...OL_MINUS, "run_block", "line_calls"], Q);
