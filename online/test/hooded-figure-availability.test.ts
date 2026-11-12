import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { ensureHoodedFigureState, resolveHoodedFigureEncounter } from "@/state/hoodedFigure.ts";
import { fillRosterGaps } from "@/state/seed.ts";

import { signSession } from "../src/auth.js";
import { pool, readLeague, withLeague } from "../src/db.js";
import { server } from "../src/index.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * `hoodedFigure.unavailable` lists the players a negative bargain sidelined —
 * which is also the team that was hit and for how long. The league document
 * goes to every GM, and the redactor handled the encounters but not this list,
 * so another GM could read it from `GET /leagues/:id` before League
 * Developments. These call the real route. Synthetic accounts and data only.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = { payer: `hfa_payer_${stamp}`, second: `hfa_second_${stamp}`, viewer: `hfa_viewer_${stamp}` };
let leagueId = "";
let baseUrl = "";
let baseline = "";
let stored: { playerId: string; untilWeek: number | null }[] = [];
/** the player both bargains hit, and the duration each one disclosed */
let shared = "";
let firstWeeks: number | null = null;
let secondWeeks: number | null = null;
let season = 0;

const restore = (text: string) =>
  withLeague(leagueId, async () => ({ result: null, state: JSON.parse(text) as LeagueState, events: [] }));
const setup = (change: (s: LeagueState) => void) =>
  withLeague(leagueId, async ({ state }) => {
    change(state);
    return { result: null, state, events: [] };
  });

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  for (const u of Object.values(users)) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
       VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [u],
    );
  }
  leagueId = (await createOnlineLeague(users.payer, { name: "Figure availability", humanSlots: 3 })).leagueId;
  await claimTeam(leagueId, users.payer, "BUF");
  await claimTeam(leagueId, users.second, "MIA");
  await claimTeam(leagueId, users.viewer, "KC");
  await setup((s) => {
    fillRosterGaps(s);
    season = s.season;
    s.stage = "hoodedFigureEncounter";
    const hf = ensureHoodedFigureState(s);
    const mk = (year: number, team = "BUF") => ({
      teamCode: team, season: year, thresholds: { t1: 20, t2: 40, t3: 60 },
      payment: 0, resolved: false, swindle: false, branch: null, tier: null, outcome: null,
    });
    // an older encounter, long public, with nothing sidelined
    hf.encountersBySeason[s.season - 2] = { BUF: { ...mk(s.season - 2), resolved: true } as never };
    hf.encountersBySeason[s.season] = { BUF: mk(s.season) as never };
    // BUF and MIA share a division, so both hit the same CPU team. Find two
    // payments whose seeded outcomes sideline the same player for different
    // lengths: the second bargain then overwrites the stored duration.
    hf.encountersBySeason[s.season]!.MIA = mk(s.season, "MIA") as never;
    hf.firstNegativeConsumed = true;
    search: for (let pa = 1; pa <= 40; pa += 0.5) {
      for (let pb = 1; pb <= 40; pb += 0.5) {
        const copy = structuredClone(s);
        const a = resolveHoodedFigureEncounter(copy, "BUF", pa).outcome;
        const b = resolveHoodedFigureEncounter(copy, "MIA", pb).outcome;
        const both = (a?.negativePlayers ?? []).find((x) => b?.negativePlayers?.some((y) => y.playerId === x.playerId));
        if (both && a!.absenceWeeks !== b!.absenceWeeks) {
          resolveHoodedFigureEncounter(s, "BUF", pa);
          resolveHoodedFigureEncounter(s, "MIA", pb);
          shared = both.playerId;
          firstWeeks = a!.absenceWeeks ?? null;
          secondWeeks = b!.absenceWeeks ?? null;
          break search;
        }
      }
    }
    if (!shared) throw new Error("no pair of payments overlaps on one player; widen the search");
    stored = JSON.parse(JSON.stringify(s.hoodedFigure!.unavailable));
  });
  baseline = JSON.stringify((await readLeague(leagueId))!.state);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (reachable) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => {});
    for (const u of Object.values(users)) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await restore(baseline);
    await fn();
  });

const read = async (user: string) => {
  const res = await fetch(`${baseUrl}/leagues/${leagueId}`, { headers: { cookie: `sid=${signSession(user)}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { state: LeagueState }).state;
};
const at = (stage: LeagueState["stage"], rolled: boolean) =>
  setup((s) => {
    s.stage = stage;
    s.season = rolled ? season + 1 : season;
  });

const sharedEntry = (s: LeagueState) => s.hoodedFigure!.unavailable.filter((u) => u.playerId === shared);

describe("the figure's sidelined list, over GET /leagues/:id", () => {
  maybe("really holds two bargains on one player, the second overwriting the duration", async () => {
    expect(shared).not.toBe("");
    expect(firstWeeks).not.toBe(secondWeeks);
    expect(stored.length).toBeGreaterThan(0);
    const raw = (await readLeague(leagueId))!.state;
    expect(raw.hoodedFigure!.unavailable).toEqual(stored);
    expect(sharedEntry(raw)).toEqual([{ playerId: shared, untilWeek: secondWeeks }]);
  });

  maybe("is not sent to an unrelated team before rollover", async () => {
    for (const stage of ["hoodedFigureEncounter", "offseasonDepthChart"] as const) {
      await at(stage, false);
      const s = await read(users.viewer);
      expect(s.hoodedFigure!.unavailable, stage).toEqual([]);
      expect(JSON.stringify(s.hoodedFigure), stage).not.toContain(shared);
    }
  });

  maybe("is not sent to an unrelated team in the preseason after rollover", async () => {
    await at("preseason", true);
    const s = await read(users.viewer);
    expect(s.hoodedFigure!.unavailable).toEqual([]);
    expect(JSON.stringify(s.hoodedFigure)).not.toContain(shared);
  });

  maybe("shows each payer only the duration their own bargain disclosed, before the reveal", async () => {
    for (const [stage, rolled] of [["hoodedFigureEncounter", false], ["offseasonDepthChart", false], ["preseason", true]] as const) {
      await at(stage, rolled);
      const first = await read(users.payer);
      const second = await read(users.second);
      expect(sharedEntry(first), `${stage} first payer`).toEqual([{ playerId: shared, untilWeek: firstWeeks }]);
      expect(sharedEntry(second), `${stage} second payer`).toEqual([{ playerId: shared, untilWeek: secondWeeks }]);
    }
  });

  maybe("comes back as the authoritative list at League Developments and in the regular season", async () => {
    for (const stage of ["leagueDevelopments", "regularSeason"] as const) {
      await at(stage, true);
      for (const u of [users.viewer, users.payer, users.second]) {
        const s = await read(u);
        expect(s.hoodedFigure!.unavailable, stage).toEqual(stored);
        expect(sharedEntry(s), stage).toEqual([{ playerId: shared, untilWeek: secondWeeks }]);
      }
      const v = await read(users.viewer);
      expect(v.hoodedFigure!.encountersBySeason[season]!.BUF!.outcome, stage).not.toBeNull();
    }
  });

  maybe("keeps the payer's own encounter visible before the reveal, price points still hidden", async () => {
    await at("preseason", true);
    const s = await read(users.payer);
    const e = s.hoodedFigure!.encountersBySeason[season]!;
    expect(e.BUF!.resolved).toBe(true);
    expect(e.BUF!.thresholds).toEqual({ t1: 0, t2: 0, t3: 0 });
    expect(e.MIA).toBeUndefined();
  });

  maybe("hides the encounters from an unrelated team until the reveal", async () => {
    await at("preseason", true);
    const s = await read(users.viewer);
    expect(s.hoodedFigure!.encountersBySeason[season]!.BUF).toBeUndefined();
    expect(s.hoodedFigure!.encountersBySeason[season]!.MIA).toBeUndefined();
    // the older, public encounter is still shown (thresholds hidden)
    expect(s.hoodedFigure!.encountersBySeason[season - 2]!.BUF!.thresholds).toEqual({ t1: 0, t2: 0, t3: 0 });
  });

  maybe("does not change what is stored when it is read, before or after the reveal", async () => {
    for (const stage of ["preseason", "leagueDevelopments"] as const) {
      await at(stage, true);
      const before = JSON.stringify((await readLeague(leagueId))!.state.hoodedFigure);
      for (const u of [users.viewer, users.payer, users.second]) await read(u);
      expect(JSON.stringify((await readLeague(leagueId))!.state.hoodedFigure), stage).toBe(before);
      expect((await readLeague(leagueId))!.state.hoodedFigure!.unavailable, stage).toEqual(stored);
    }
  });
});
