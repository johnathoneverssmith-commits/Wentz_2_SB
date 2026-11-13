/**
 * COMP-006 runner. One vitest test = one (seed, talent, arm) league-run; the orchestrator (run.sh) fans these out.
 *   C6=1 C6_SEED=101 C6_TALENT=1.5 C6_ARM=skilled C6_SEASONS=10 C6_SEATS=4 C6_OUT=out/ npx vitest run -c vitest.config.ts run.test.ts
 * Optional: C6_MODS=draft,fa,... (policy modules; default all), C6_TAG=name for the output file.
 */
import { describe, it, expect, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const calls = { engine: 0, scales: {} as Record<string, number>, mock: {} as Record<string, number> };
vi.mock("../../src/engine/sim.js", async (orig) => {
  const m: any = await orig();
  return { ...m, simulateGame: (...a: any[]) => { calls.engine++; const k = String(a[3]?.talentScale); calls.scales[k] = (calls.scales[k] ?? 0) + 1; return m.simulateGame(...a); } };
});

import { MockSimulationService } from "@/sim/MockSimulationService";
import { playLeague, pickSeats, buildLeague, STAGE_LOG, NOT_EXERCISED, type RunSpec } from "./driver.js";

const ON = !!process.env.C6;
// X0-style path check: count every MockSimulationService method so a Mock game simulation would show up
for (const k of Object.getOwnPropertyNames(MockSimulationService.prototype)) {
  if (k === "constructor") continue;
  const f = (MockSimulationService.prototype as any)[k];
  if (typeof f !== "function") continue;
  (MockSimulationService.prototype as any)[k] = function (...a: any[]) { calls.mock[k] = (calls.mock[k] ?? 0) + 1; return f.apply(this, a); };
}
describe.skipIf(!ON)("comp006 run", () => {
  it("plays one league", () => {
    const seed = Number(process.env.C6_SEED ?? 101);
    const talent = Number(process.env.C6_TALENT ?? 1.5);
    const arm = (process.env.C6_ARM ?? "control") as RunSpec["arm"];
    const seasons = Number(process.env.C6_SEASONS ?? 2);
    const k = Number(process.env.C6_SEATS ?? 4);
    const mods = (process.env.C6_MODS ?? "").split(",").filter(Boolean) as RunSpec["mods"];
    const spec: RunSpec = { seed, talent, arm, seasons, seats: pickSeats(seed, k), mods };
    const t0 = Date.now();
    const start = buildLeague(spec);
    const fingerprint = createHash("sha256").update(JSON.stringify(Object.values(start.players).map((p) => [p.id, p.nfl_team, p.overall, p.age]).sort())).digest("hex");
    const res = playLeague(spec, (m) => console.log(m));
    const out = {
      spec, fingerprint, runtimeSec: (Date.now() - t0) / 1000, engineCalls: calls.engine, talentScalesSeen: calls.scales, mockCalls: calls.mock,
      stagesVisited: Object.fromEntries(STAGE_LOG), notExercised: NOT_EXERCISED,
      rows: res.rows, seats: res.seats, log: res.log.slice(0, 200),
    };
    const dir = process.env.C6_OUT ?? "out";
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${process.env.C6_TAG ?? `${arm}_s${seed}_t${talent}`}.json`, JSON.stringify(out));
    expect(res.rows.length).toBe(seasons);
    expect(calls.engine).toBeGreaterThan(100);
    // the real engine ran every game, at the intended talent scale, and the Mock never simulated one
    expect(Object.keys(calls.scales)).toEqual([String(talent)]);
    for (const k of Object.keys(calls.mock)) expect(k).not.toMatch(/^simulate(Week|Game|Season|PlayoffRound)/);
  }, 7_200_000);
});
