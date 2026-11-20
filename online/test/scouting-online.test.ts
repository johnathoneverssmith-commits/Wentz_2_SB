import type { AddressInfo } from "node:net";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { LeagueState } from "@/domain";
import { expectedRatings } from "@/state/draftBoard.ts";
import { makeReport, publicRanks, reportsFor, HUMAN_POINTS, CPU_POINTS } from "@/state/scouting.ts";
import { fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";

import { actorFor, makeDraftPick, autopickFor } from "../src/actions.js";
import { signSession } from "../src/auth.js";
import { pool, readLeague, withLeague } from "../src/db.js";
import { server } from "../src/index.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { onStageEntered } from "../src/phases.js";
import { SALT_BYTES, saltedNormal } from "../src/scouting.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * Online scouting against a real database: the server-held salt, team isolation in every view, atomic spending,
 * duplicate requests, persistence, the draft lifecycle, the switches, and leagues that never opted in.
 * Synthetic accounts and data only.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = { comm: `sc_comm_${stamp}`, a: `sc_a_${stamp}`, b: `sc_b_${stamp}`, c: `sc_c_${stamp}` };
const TEAM = { a: "BUF", b: "MIA", c: "KC" } as const;
let leagueId = "";
let plainId = "";
let baseUrl = "";
let baseline = "";
const savedSwitch = process.env.ONLINE_SCOUTING;

const setup = (id: string, change: (s: LeagueState) => void) =>
  withLeague(id, async ({ state }) => {
    change(state);
    return { result: null, state, events: [] };
  });
const restore = (text: string) =>
  withLeague(leagueId, async () => ({ result: null, state: JSON.parse(text) as LeagueState, events: [] }));

async function http(method: "GET" | "POST", path: string, user: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { cookie: `sid=${signSession(user)}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, text: await res.text() };
}
const view = async (user: string, id = leagueId) => {
  const r = await http("GET", `/leagues/${id}`, user);
  expect(r.status).toBe(200);
  return { raw: r.text, state: (JSON.parse(r.text) as { state: LeagueState }).state };
};
type Out = {
  ok?: boolean; version?: string; error?: string;
  purchased?: { id: string; report: { estimate: number } }[]; owned?: { id: string; report: { estimate: number } }[];
  refused?: { id: string; reason: string }[]; left?: number;
};
const scout = async (user: string, body: unknown, id = leagueId) => {
  const r = await http("POST", `/leagues/${id}/actions/scout`, user, body);
  return { status: r.status, json: JSON.parse(r.text) as Out };
};
const rawLedger = async () => (await readLeague(leagueId))!.state.scouting;
const versionOf = async (id = leagueId) =>
  (await pool.query<{ version: string }>(`SELECT version FROM league_state WHERE league_id = $1`, [id])).rows[0]!.version;
const secretRows = async (id = leagueId) =>
  (await pool.query<{ scout_salt: Buffer }>(`SELECT scout_salt FROM league_secrets WHERE league_id = $1`, [id])).rows;

/** prospects by public rank, so tests pick real ids */
function ranked(s: LeagueState): string[] {
  const ranks = publicRanks(s.draftClass, expectedRatings(s.draftClass, 1));
  return [...s.draftClass].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!).map((p) => p.id);
}
let ids: string[] = [];

async function openDraft(id: string) {
  await setup(id, (s) => {
    fillRosterGaps(s);
    recomputeTeamRatings(s);
    s.stage = "offseasonDraft" as never;
    s.draft = undefined as never;
    delete s.scouting;
    onStageEntered(s, "offseasonRetirement");
  });
}

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  process.env.ONLINE_SCOUTING = "1";
  for (const u of Object.values(users)) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [u],
    );
  }
  // the commissioner never claims a team: the spectator view
  leagueId = (await createOnlineLeague(users.comm, { name: "Scouting", humanSlots: 3, config: { scouting: true } })).leagueId;
  await claimTeam(leagueId, users.a, TEAM.a);
  await claimTeam(leagueId, users.b, TEAM.b);
  await claimTeam(leagueId, users.c, TEAM.c);
  // a league made without the opt-in, as every existing league is
  plainId = (await createOnlineLeague(users.comm, { name: "Plain", humanSlots: 1 })).leagueId;
  await claimTeam(plainId, users.a, TEAM.a);
  await openDraft(leagueId);
  await openDraft(plainId);
  // the draft order is random and the CPU teams ahead of the first human have already picked: only the undrafted can be scouted
  const opened = (await readLeague(leagueId))!.state;
  const gone = new Set(opened.draft!.results.map((r) => r.selectedId));
  ids = ranked(opened).filter((id) => !gone.has(id));
  baseline = JSON.stringify((await readLeague(leagueId))!.state);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (savedSwitch === undefined) delete process.env.ONLINE_SCOUTING;
  else process.env.ONLINE_SCOUTING = savedSwitch;
  if (reachable) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const id of [leagueId, plainId]) await pool.query(`DELETE FROM leagues WHERE id = $1`, [id]).catch(() => {});
    for (const u of Object.values(users)) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>, timeout?: number) =>
  it(
    url ? name : `${name} — SKIPPED, no DATABASE_URL`,
    async () => {
      if (!reachable) return;
      process.env.ONLINE_SCOUTING = "1";
      await restore(baseline);
      await pool.query(`DELETE FROM league_secrets WHERE league_id = $1`, [plainId]);
      await fn();
    },
    timeout,
  );

describe("online scouting: the secret and the opening", () => {
  maybe("creates a 32-byte salt with the league, and the CPU teams buy their reports from it", async () => {
    const rows = await secretRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scout_salt.length).toBe(SALT_BYTES);
    const ledger = (await rawLedger())!;
    const teams = Object.keys(ledger.reports);
    expect(teams.length).toBeGreaterThan(0);
    for (const t of teams) expect(Object.keys(ledger.reports[t]!).length).toBeLessThanOrEqual(CPU_POINTS);
    expect(teams).not.toContain(TEAM.a);
  });

  maybe("noise is not a function of the seed the clients are sent", async () => {
    const s = (await readLeague(leagueId))!.state;
    const expected = expectedRatings(s.draftClass, 1);
    const rank = publicRanks(s.draftClass, expected);
    const sample = ids.slice(40, 60);
    const out = await scout(users.a, { prospectIds: sample });
    expect(out.status).toBe(200);
    const salt = (await secretRows())[0]!.scout_salt;
    let differs = 0;
    for (const p of out.json.purchased!) {
      const pr = s.draftClass.find((x) => x.id === p.id)!;
      const fromSeed = makeReport({ seed: s.seed ?? 0, year: s.draft!.year, prospect: pr, projection: expected.get(p.id)!, rank: rank.get(p.id)! });
      const fromSalt = makeReport({ seed: 0, year: s.draft!.year, prospect: pr, projection: expected.get(p.id)!, rank: rank.get(p.id)!, z: saltedNormal(salt, s.draft!.year, p.id) });
      expect(p.report.estimate).toBe(fromSalt.estimate);
      if (fromSeed.estimate !== p.report.estimate) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });
});

describe("online scouting: team isolation in every view", () => {
  maybe("each GM's pull carries their own team's reports and no other team's", async () => {
    await scout(users.a, { prospectIds: ids.slice(0, 3) });
    await scout(users.b, { prospectIds: ids.slice(1, 4) });
    const rawBefore = await rawLedger();
    expect(Object.keys(rawBefore!.reports)).toEqual(expect.arrayContaining([TEAM.a, TEAM.b]));
    for (const [u, team] of [[users.a, TEAM.a], [users.b, TEAM.b], [users.c, TEAM.c]] as const) {
      const v = await view(u);
      expect(Object.keys(v.state.scouting?.reports ?? {}).every((t) => t === team)).toBe(true);
      expect(Object.keys(v.state.scouting?.reports ?? {})).toEqual(team === TEAM.c ? [] : [team]);
    }
    // a CPU team's targets are not disclosed either
    const cpu = Object.keys(rawBefore!.reports).find((t) => !(Object.values(TEAM) as string[]).includes(t))!;
    expect((await view(users.a)).raw).not.toContain(`"${cpu}":{"p`);
    expect(Object.keys((await view(users.a)).state.scouting!.reports)).not.toContain(cpu);
  });

  maybe("the commissioner without a team, and an outsider, get no ledger; the action refuses a team-less caller", async () => {
    await scout(users.a, { prospectIds: ids.slice(0, 2) });
    const v = await view(users.comm);
    expect(v.state.scouting).toBeUndefined();
    const out = await scout(users.comm, { prospectIds: ids.slice(0, 2) });
    expect(out.status).toBe(403);
    const stranger = await http("GET", `/leagues/${leagueId}`, "sc_nobody");
    expect([401, 403]).toContain(stranger.status);
  });

  maybe("the 'have' poll and action responses carry no ledger or other team's reports", async () => {
    const out = await scout(users.a, { prospectIds: ids.slice(0, 2) });
    expect(Object.keys(out.json).sort()).toEqual(["left", "ok", "owned", "purchased", "refused", "version"]);
    const poll = await http("GET", `/leagues/${leagueId}?have=${out.json.version}`, users.a);
    expect(poll.text).not.toContain("reports");
  });

  maybe("a team code in the request body is ignored: the seat decides whose ledger is charged", async () => {
    const out = await scout(users.a, { prospectIds: ids.slice(10, 12), teamCode: TEAM.b, team: TEAM.b });
    expect(out.json.purchased).toHaveLength(2);
    const ledger = (await rawLedger())!;
    expect(Object.keys(ledger.reports[TEAM.a] ?? {})).toEqual(expect.arrayContaining(ids.slice(10, 12)));
    expect(Object.keys(ledger.reports[TEAM.b] ?? {})).toHaveLength(0);
  });
});

describe("online scouting: duplicate and partial requests", () => {
  maybe("dedupes in request order; a repeat spends nothing and leaves the version alone; a purchase bumps it", async () => {
    const v0 = await versionOf();
    const first = await scout(users.a, { prospectIds: [ids[20]!, ids[21]!, ids[20]!] });
    expect(first.json.purchased!.map((p) => p.id)).toEqual([ids[20], ids[21]]);
    expect(first.json.left).toBe(HUMAN_POINTS - 2);
    const v1 = await versionOf();
    expect(Number(v1)).toBeGreaterThan(Number(v0));
    const again = await scout(users.a, { prospectIds: [ids[20]!, ids[21]!, ids[20]!] });
    expect(again.json.purchased).toHaveLength(0);
    expect(again.json.owned!.map((p) => p.id)).toEqual([ids[20], ids[21]]);
    expect(again.json.owned!.map((p) => p.report.estimate)).toEqual(first.json.purchased!.map((p) => p.report.estimate));
    expect(again.json.left).toBe(HUMAN_POINTS - 2);
    expect(await versionOf()).toBe(v1);
  });

  maybe("a partial batch buys what it can and says why it refused the rest, in order", async () => {
    const out = await scout(users.a, { prospectIds: ["nobody", ids[30]!, ids[31]!] });
    expect(out.status).toBe(200);
    expect(out.json.purchased!.map((p) => p.id)).toEqual([ids[30], ids[31]]);
    expect(out.json.refused).toEqual([{ id: "nobody", reason: "unknown-prospect" }]);
    // fill the budget, then ask for more
    await scout(users.a, { prospectIds: ids.slice(100, 140) });
    const over = await scout(users.a, { prospectIds: ids.slice(150, 155) });
    expect(over.json.purchased).toHaveLength(0);
    expect(over.json.refused!.every((r) => r.reason === "no-points")).toBe(true);
    expect(Object.keys((await rawLedger())!.reports[TEAM.a]!)).toHaveLength(HUMAN_POINTS);
  });

  maybe("'needs' is chosen by the server from public data", async () => {
    const out = await scout(users.a, { needs: true });
    expect(out.status).toBe(200);
    expect(out.json.purchased!.length).toBeGreaterThan(0);
    const bad = await scout(users.a, { prospectIds: "all" });
    expect(bad.status).toBe(400);
  });
});

describe("online scouting: concurrent spending", () => {
  maybe("one GM's parallel requests never overspend or double-buy", async () => {
    const batches = Array.from({ length: 6 }, (_, i) => ids.slice(60 + i * 8, 68 + i * 8));
    const outs = await Promise.all(batches.map((b) => scout(users.a, { prospectIds: b })));
    for (const o of outs) expect(o.status).toBe(200);
    const bought = outs.flatMap((o) => o.json.purchased!.map((p) => p.id));
    expect(new Set(bought).size).toBe(bought.length);
    expect(bought.length).toBe(HUMAN_POINTS);
    expect(Object.keys((await rawLedger())!.reports[TEAM.a]!)).toHaveLength(HUMAN_POINTS);
  });

  maybe("two GMs at once each spend their own budget, and read the same number for the same prospect", async () => {
    const shared = ids.slice(70, 90);
    const [oa, ob] = await Promise.all([scout(users.a, { prospectIds: shared }), scout(users.b, { prospectIds: shared })]);
    const ledger = (await rawLedger())!;
    expect(Object.keys(ledger.reports[TEAM.a]!)).toHaveLength(20);
    expect(Object.keys(ledger.reports[TEAM.b]!)).toHaveLength(20);
    for (const id of shared) expect(ledger.reports[TEAM.a]![id]).toEqual(ledger.reports[TEAM.b]![id]);
    expect(oa.json.left).toBe(HUMAN_POINTS - 20);
    expect(ob.json.left).toBe(HUMAN_POINTS - 20);
  });

  maybe("the salt is made once under concurrent first use", async () => {
    await pool.query(`DELETE FROM league_secrets WHERE league_id = $1`, [leagueId]);
    const outs = await Promise.all([users.a, users.b, users.c, users.a].map((u, i) => scout(u, { prospectIds: ids.slice(40 + i, 44 + i) })));
    for (const o of outs) expect(o.status).toBe(200);
    expect(await secretRows()).toHaveLength(1);
    const ledger = (await rawLedger())!;
    for (const id of ids.slice(41, 44)) {
      const seen = [TEAM.a, TEAM.b, TEAM.c].map((t) => ledger.reports[t]?.[id]).filter(Boolean);
      // compared by value: the newest version is served from the server's cached JSON (insertion order), older ones from JSONB (sorted keys)
      expect(new Set(seen.map((r) => `${r!.estimate}|${r!.lo}|${r!.hi}`)).size).toBe(1);
      expect(seen.length).toBeGreaterThanOrEqual(2); // each of these was asked for by at least two teams
    }
  });
});

describe("online scouting: persistence", () => {
  maybe("a report survives a reload, and the same salt re-draws the same report after the ledger is lost", async () => {
    const first = await scout(users.a, { prospectIds: [ids[45]!] });
    const r1 = first.json.purchased![0]!.report.estimate;
    expect((await view(users.a)).state.scouting!.reports[TEAM.a]![ids[45]!]!.estimate).toBe(r1);
    // the ledger is gone but the secret stays (a restore, a restart): the same prospect reads the same
    await setup(leagueId, (s) => {
      delete s.scouting!.reports[TEAM.a]![ids[45]!];
    });
    const second = await scout(users.a, { prospectIds: [ids[45]!] });
    expect(second.json.purchased![0]!.report.estimate).toBe(r1);
    const salt = (await secretRows())[0]!.scout_salt;
    expect(salt.length).toBe(SALT_BYTES);
  });

  maybe("a league that never opted in refuses, creates no secret, and shows no ledger", async () => {
    const out = await scout(users.a, { prospectIds: ids.slice(0, 2) }, plainId);
    expect(out.status).toBe(400);
    expect(await secretRows(plainId)).toHaveLength(0);
    const v = await view(users.a, plainId);
    expect(v.state.scouting).toBeUndefined();
    expect(v.state.config.scouting).toBeUndefined();
  });
});

describe("online scouting: the switches and the secret", () => {
  maybe("with ONLINE_SCOUTING off: the action refuses, the view hides the ledger, a new draft buys nothing, creation is refused", async () => {
    delete process.env.ONLINE_SCOUTING;
    const out = await scout(users.a, { prospectIds: ids.slice(0, 2) });
    expect(out.status).toBe(400);
    expect(out.json.error).toMatch(/switched off/i);
    expect((await view(users.a)).state.scouting).toBeUndefined();
    await openDraft(leagueId);
    expect((await readLeague(leagueId))!.state.scouting).toBeUndefined();
    await expect(createOnlineLeague(users.comm, { name: "Nope", humanSlots: 1, config: { scouting: true } })).rejects.toThrow(/isn't available/);
    expect((await http("GET", "/features", users.a)).text).toContain('"scouting":false');
  });

  maybe("the commissioner cannot turn scouting on for a league that was made without it", async () => {
    const r = await http("POST", `/leagues/${plainId}/admin/config`, users.comm, { patch: { scouting: true } });
    expect(r.status).toBe(400);
    expect((await readLeague(plainId))!.state.config.scouting).toBeUndefined();
  });

  maybe("an unreadable secret refuses clearly and changes nothing", async () => {
    const v0 = await versionOf();
    // the secret's table cannot be read (no DDL here: any statement that names it fails on the connection)
    const original = pg.Client.prototype.query as (...a: unknown[]) => unknown;
    const spy = vi.spyOn(pg.Client.prototype, "query").mockImplementation(function (this: unknown, ...a: unknown[]) {
      return /league_secrets/.test(String((a[0] as { text?: string })?.text ?? a[0]))
        ? Promise.reject(new Error('relation "league_secrets" does not exist'))
        : original.apply(this, a);
    } as never);
    try {
      const out = await scout(users.a, { prospectIds: ids.slice(0, 2) });
      expect(out.status).toBe(503);
      expect(out.json.error).toMatch(/Online scouting is unavailable/);
    } finally {
      spy.mockRestore();
    }
    expect(await versionOf()).toBe(v0);
  });
});

describe("online scouting: the draft lifecycle", () => {
  maybe("opens with the draft, is refused once it is over, and is gone from the document and every view", async () => {
    await scout(users.a, { prospectIds: ids.slice(0, 3) });
    expect((await view(users.a)).state.scouting).toBeDefined();
    // play the whole rookie draft the way the screens do: humans pick on their turns, the CPU plays itself
    const actors = {
      [TEAM.a]: await actorFor(leagueId, users.a),
      [TEAM.b]: await actorFor(leagueId, users.b),
      [TEAM.c]: await actorFor(leagueId, users.c),
    } as Record<string, Awaited<ReturnType<typeof actorFor>>>;
    for (let guard = 0; guard < 400; guard++) {
      const s = (await readLeague(leagueId))!.state;
      const d = s.draft;
      if (s.stage !== "offseasonDraft" || !d || d.currentPickIndex >= d.pickOrder.length) break;
      const team = d.pickOrder[d.currentPickIndex]!;
      const pick = autopickFor(s, team);
      if (!actors[team] || !pick) throw new Error(`stuck on ${team} at ${d.currentPickIndex}`);
      await makeDraftPick(actors[team]!, pick);
    }
    const after = (await readLeague(leagueId))!.state;
    expect(after.stage).not.toBe("offseasonDraft");
    for (const u of [users.a, users.b, users.c, users.comm]) expect((await view(u)).state.scouting).toBeUndefined();
    const refused = await scout(users.a, { prospectIds: ids.slice(0, 2) });
    expect(refused.status).toBe(400);
    // a prospect's true rating stays masked until his pick is settled
    const v = await view(users.a);
    const unsettled = v.state.draftClass.filter((p) => !v.state.rookieOutcomes?.[p.id]);
    expect(unsettled.length).toBeGreaterThan(0);
    expect(unsettled.every((p) => p.trueOverall === 0)).toBe(true);
  }, 300_000);

  maybe("leaving the draft stage clears the ledger even if the draft never finished", async () => {
    await scout(users.a, { prospectIds: ids.slice(0, 2) });
    await setup(leagueId, (s) => {
      s.stage = "offseasonDraftSummary" as never;
      onStageEntered(s, "offseasonDraft");
    });
    expect((await readLeague(leagueId))!.state.scouting).toBeUndefined();
  });

  maybe("reportsFor on the shared rules agrees with the document", async () => {
    await scout(users.a, { prospectIds: ids.slice(50, 52) });
    const s = (await readLeague(leagueId))!.state;
    expect(Object.keys(reportsFor(s, TEAM.a, s.draft!.year))).toEqual(ids.slice(50, 52));
  });
});
