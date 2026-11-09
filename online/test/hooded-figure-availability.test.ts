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
const users = { payer: `hfa_payer_${stamp}`, viewer: `hfa_viewer_${stamp}` };
let leagueId = "";
let baseUrl = "";
let baseline = "";
let stored: { playerId: string; untilWeek: number | null }[] = [];
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
  leagueId = (await createOnlineLeague(users.payer, { name: "Figure availability", humanSlots: 2 })).leagueId;
  await claimTeam(leagueId, users.payer, "BUF");
  await claimTeam(leagueId, users.viewer, "KC");
  await setup((s) => {
    fillRosterGaps(s);
    season = s.season;
    s.stage = "hoodedFigureEncounter";
    const hf = ensureHoodedFigureState(s);
    const mk = (year: number) => ({
      teamCode: "BUF", season: year, thresholds: { t1: 1, t2: 2, t3: 3 },
      payment: 0, resolved: false, swindle: false, branch: null, tier: null, outcome: null,
    });
    // an older encounter, long public, with nothing sidelined
    hf.encountersBySeason[s.season - 2] = { BUF: { ...mk(s.season - 2), resolved: true } as never };
    hf.encountersBySeason[s.season] = { BUF: mk(s.season) as never };
    // a payment whose seeded outcome sidelines named players
    for (let pay = 1; pay <= 60; pay += 0.5) {
      const copy = JSON.parse(JSON.stringify(s)) as LeagueState;
      const e = resolveHoodedFigureEncounter(copy, "BUF", pay);
      if (e.branch === "negative" && e.outcome?.negativePlayers?.length) {
        resolveHoodedFigureEncounter(s, "BUF", pay);
        break;
      }
    }
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

describe("the figure's sidelined list, over GET /leagues/:id", () => {
  maybe("really holds a sidelined player on the server", async () => {
    expect(stored.length).toBeGreaterThan(0);
    expect((await readLeague(leagueId))!.state.hoodedFigure!.unavailable).toEqual(stored);
  });

  maybe("is not sent to another team before rollover", async () => {
    for (const stage of ["hoodedFigureEncounter", "offseasonDepthChart"] as const) {
      await at(stage, false);
      const s = await read(users.viewer);
      expect(s.hoodedFigure!.unavailable, stage).toEqual([]);
      expect(JSON.stringify(s.hoodedFigure), stage).not.toContain(stored[0]!.playerId);
    }
  });

  maybe("is not sent to another team in the preseason after rollover", async () => {
    await at("preseason", true);
    const s = await read(users.viewer);
    expect(s.hoodedFigure!.unavailable).toEqual([]);
    expect(JSON.stringify(s.hoodedFigure)).not.toContain(stored[0]!.playerId);
  });

  maybe("comes back, player and duration, at League Developments and in the regular season", async () => {
    for (const stage of ["leagueDevelopments", "regularSeason"] as const) {
      await at(stage, true);
      const s = await read(users.viewer);
      expect(s.hoodedFigure!.unavailable, stage).toEqual(stored);
      expect(s.hoodedFigure!.encountersBySeason[season]!.BUF!.outcome, stage).not.toBeNull();
    }
  });

  maybe("keeps the payer's own bargain visible before the reveal, price points still hidden", async () => {
    await at("preseason", true);
    const s = await read(users.payer);
    expect(s.hoodedFigure!.unavailable).toEqual(stored);
    expect(s.hoodedFigure!.encountersBySeason[season]!.BUF!.resolved).toBe(true);
    expect(s.hoodedFigure!.encountersBySeason[season]!.BUF!.thresholds).toEqual({ t1: 0, t2: 0, t3: 0 });
  });

  maybe("hides the encounter itself from the other team until the reveal", async () => {
    await at("preseason", true);
    const s = await read(users.viewer);
    expect(s.hoodedFigure!.encountersBySeason[season]!.BUF).toBeUndefined();
    // the older, public encounter is still shown (thresholds hidden)
    expect(s.hoodedFigure!.encountersBySeason[season - 2]!.BUF!.thresholds).toEqual({ t1: 0, t2: 0, t3: 0 });
  });

  maybe("does not change what is stored when it is read", async () => {
    await at("preseason", true);
    const before = JSON.stringify((await readLeague(leagueId))!.state.hoodedFigure);
    await read(users.viewer);
    await read(users.payer);
    expect(JSON.stringify((await readLeague(leagueId))!.state.hoodedFigure)).toBe(before);
    expect((await readLeague(leagueId))!.state.hoodedFigure!.unavailable).toEqual(stored);
  });
});
