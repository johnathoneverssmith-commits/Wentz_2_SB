/**
 * Multiplayer failure drill against a REAL league-server process.
 *
 * `online/test/reliability-audit.test.ts` calls the modules directly. This
 * drill starts the actual server (`online/src/index.ts`) as a child process,
 * talks to it over HTTP as three browsers would, and kills it with SIGKILL in
 * the middle of a database transaction. It is not part of `npm run online:test`
 * (it spawns a server and applies the schema, which the suites must not do —
 * see `no-schema-in-suites.test.ts`).
 *
 *   # a throwaway local PostgreSQL, never a shared or deployed one
 *   DATABASE_URL=postgres://postgres@127.0.0.1:5544/postgres \
 *     npx tsx --tsconfig online/tsconfig.json online/dev/reliability-drill.ts
 *
 * Scenarios, in order:
 *   1. two browsers of one user submit the same draft pick at once
 *   2. a stale tab re-submits a pick after the turn moved on
 *   3. a GM "refreshes": fresh session, reads the league, takes their turn
 *   4. the server is SIGKILLed while its transaction is open (a trigger makes
 *      the commit slow enough to hit), restarted, and the same pick is retried
 *   5. a repeated stage-advance (commissioner double press)
 *
 * Exit code 0 only if every check passed. It prints what it saw either way.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";

import pg from "pg";

import type { LeagueState } from "@/domain";
import { beginDraft } from "@/state/rules.ts";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)([:/]|$)/.test(dbUrl)) {
  console.error("refusing to run: DATABASE_URL must point at a PostgreSQL on this machine. This drill kills the server and installs a trigger.");
  process.exit(2);
}

const stamp = Date.now();
let failures = 0;
const check = (ok: boolean, what: string, detail?: unknown) => {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail === undefined ? "" : `   (${JSON.stringify(detail)})`}`);
};

const db = new pg.Pool({ connectionString: dbUrl, max: 2 });

/* ---- the server under test -------------------------------------------- */

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}
const port = await freePort();
const API = `http://127.0.0.1:${port}`;
let server: ChildProcess | null = null;

async function startServer(): Promise<void> {
  server = spawn(process.execPath, ["--import", "tsx", "online/src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "development",
      TSX_TSCONFIG_PATH: "online/tsconfig.json",
      DB_POOL_MAX: "8",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr!.on("data", () => undefined);
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API}/version`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}
async function killServer(): Promise<void> {
  if (!server) return;
  const dead = new Promise((r) => server!.once("exit", r));
  server.kill("SIGKILL");
  await dead;
  server = null;
}

/* ---- a tiny browser ---------------------------------------------------- */

interface Session {
  cookie: string;
}
async function call<T = Record<string, unknown>>(
  who: Session,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: who.cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : {}) as T };
}
async function signIn(path: "register" | "login", name: string): Promise<Session> {
  const res = await fetch(`${API}/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password: "drill-password-1" }),
  });
  if (!res.ok) throw new Error(`${path} ${name}: ${res.status} ${await res.text()}`);
  return { cookie: (res.headers.get("set-cookie") ?? "").split(";")[0]! };
}

/* ---- direct database peeks (what is really committed) ------------------ */

let leagueId = "";
async function row() {
  const r = await db.query<{ state: LeagueState; version: string }>(
    `SELECT state, version FROM league_state WHERE league_id = $1`,
    [leagueId],
  );
  return { state: r.rows[0]!.state, version: Number(r.rows[0]!.version) };
}
const eventCount = async (kind?: string) =>
  Number(
    (
      await db.query(`SELECT count(*) FROM events WHERE league_id = $1 ${kind ? "AND kind = $2" : ""}`, kind ? [leagueId, kind] : [leagueId])
    ).rows[0].count,
  );

/* ---- the drill ---------------------------------------------------------- */

try {
  await startServer();
  console.log(`server up on :${port}\n`);

  const names = [`drill_gb_${stamp}`, `drill_kc_${stamp}`];
  const gbA = await signIn("register", names[0]!);
  const kcA = await signIn("register", names[1]!);
  const created = await call<{ leagueId: string; inviteCode: string }>(gbA, "POST", "/leagues", { name: "Drill", humanSlots: 2 });
  leagueId = created.body.leagueId;
  await call(gbA, "POST", `/leagues/${leagueId}/claim`, { teamCode: "GB" });
  await call(kcA, "POST", `/leagues/${leagueId}/claim`, { teamCode: "KC" });

  // put the two of them on the clock in a fantasy draft, GB first
  {
    const { state } = await row();
    state.stage = "fantasyDraft";
    beginDraft(state, "fantasy");
    state.draft!.pickOrder = ["GB", "KC", "GB", "KC", "GB", "KC"];
    state.draft!.currentPickIndex = 0;
    state.draft!.results = [];
    await db.query(
      `UPDATE league_state SET state = $2, stage = 'fantasyDraft', version = version + 1 WHERE league_id = $1`,
      [leagueId, JSON.stringify(state)],
    );
  }
  const ids = Object.values((await row()).state.players)
    .filter((p) => !p.retired)
    .map((p) => p.id);
  const pick = (n: number) => ids[n]!;
  const picks = async () => (await row()).state.draft!.results.length;

  console.log("1. two browsers of one user, the same pick, at the same instant");
  const gbB = await signIn("login", names[0]!); // a second session for the same user
  const both = await Promise.all([
    call(gbA, "POST", `/leagues/${leagueId}/actions/draft/pick`, { selectedId: pick(0) }),
    call(gbB, "POST", `/leagues/${leagueId}/actions/draft/pick`, { selectedId: pick(0) }),
  ]);
  const statuses = both.map((r) => r.status).sort();
  check(statuses[0] === 200 && statuses[1] === 409, "exactly one 200 and one 409", statuses);
  check((await picks()) === 1, "the pick was recorded once", await picks());

  console.log("\n2. a stale tab repeats the pick after the turn moved on");
  const stale = await call(gbA, "POST", `/leagues/${leagueId}/actions/draft/pick`, { selectedId: pick(1) });
  check(stale.status === 409, "refused with 409 (KC is on the clock)", stale.status);
  check((await picks()) === 1, "nothing changed", await picks());

  console.log("\n3. KC refreshes: new session, reads the league, takes the turn");
  const kcB = await signIn("login", names[1]!);
  const view = await call<{ state: LeagueState; version: string; you: { teamCode: string } | null }>(kcB, "GET", `/leagues/${leagueId}`);
  check(view.status === 200 && view.body.state.draft!.results.length === 1, "fresh session sees the pick GB made", view.body.state?.draft?.results.length);
  check(view.body.you?.teamCode === "KC", "and is recognised as KC");
  const unchanged = await call<{ unchanged?: boolean }>(kcB, "GET", `/leagues/${leagueId}?have=${view.body.version}`);
  check(unchanged.body.unchanged === true, "polling with the current version answers 'unchanged'");
  const kcPick = await call(kcB, "POST", `/leagues/${leagueId}/actions/draft/pick`, { selectedId: pick(1), version: view.body.version });
  check(kcPick.status === 200, "KC's pick lands from the new session", kcPick.status);
  const oldCookieStillWorks = await call(kcA, "GET", `/leagues/${leagueId}?have=0`);
  check(oldCookieStillWorks.status === 200, "KC's old session still works too (cookies are not single-use)", oldCookieStillWorks.status);

  console.log("\n4. SIGKILL the server in the middle of a transaction, restart, retry");
  // GB is on the clock again (pick index 2). The trigger makes the UPDATE
  // inside the action's transaction take 4s, so the kill lands between the
  // write and the COMMIT.
  await db.query(`
    CREATE OR REPLACE FUNCTION drill_slow() RETURNS trigger AS $f$
    BEGIN IF NEW.league_id = '${leagueId}' THEN PERFORM pg_sleep(4); END IF; RETURN NEW; END $f$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS drill_slow ON league_state;
    CREATE TRIGGER drill_slow BEFORE UPDATE ON league_state FOR EACH ROW EXECUTE FUNCTION drill_slow();
  `);
  const before = await row();
  const eventsBefore = await eventCount();
  const inFlight = call(gbA, "POST", `/leagues/${leagueId}/actions/draft/pick`, { selectedId: pick(2) }).catch((e: unknown) => ({ status: 0, body: String(e) }));
  await new Promise((r) => setTimeout(r, 1500));
  await killServer();
  const lost = await inFlight;
  check(lost.status === 0, "the client's request fails (connection reset), it is never told 'ok'", (lost as { status: number }).status);
  await new Promise((r) => setTimeout(r, 5000)); // let the orphaned backend notice and roll back
  const after = await row();
  check(after.version === before.version, "version unchanged after the kill", { before: before.version, after: after.version });
  check(after.state.draft!.results.length === before.state.draft!.results.length, "no half-written pick");
  check((await eventCount()) === eventsBefore, "no event row for the lost action");

  await db.query(`DROP TRIGGER IF EXISTS drill_slow ON league_state; DROP FUNCTION IF EXISTS drill_slow();`);
  await startServer();
  const resumed = await call<{ unchanged?: boolean }>(gbA, "GET", `/leagues/${leagueId}?have=${after.version}`);
  check(resumed.status === 200 && resumed.body.unchanged === true, "after restart the same session and version still work", resumed.status);
  const retry = await call(gbA, "POST", `/leagues/${leagueId}/actions/draft/pick`, { selectedId: pick(2) });
  check(retry.status === 200, "the retry applies", retry.status);
  const again = await call(gbA, "POST", `/leagues/${leagueId}/actions/draft/pick`, { selectedId: pick(2) });
  check(again.status === 409 || again.status === 400, "and a second retry is refused, not applied twice", again.status);
  check((await picks()) === before.state.draft!.results.length + 1, "exactly one pick landed", await picks());

  console.log("\n5. commissioner double press on force-advance");
  const startStage = (await row()).state.stage;
  const forced = await Promise.all([
    call(gbA, "POST", `/leagues/${leagueId}/admin/advance`, {}),
    call(gbA, "POST", `/leagues/${leagueId}/admin/advance`, {}),
  ]);
  const { state: afterForce } = await row();
  console.log(`   ${startStage} -> ${afterForce.stage}; statuses ${forced.map((f) => f.status).join(",")}`);
  const moves = await eventCount("phase.forced");
  check(moves === 1, "one press moved the league one step (two presses must not move it twice)", { forcedEvents: moves });
} finally {
  await db.query(`DROP TRIGGER IF EXISTS drill_slow ON league_state; DROP FUNCTION IF EXISTS drill_slow();`).catch(() => undefined);
  if (leagueId) await db.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => undefined);
  await db.query(`DELETE FROM users WHERE id IN (SELECT id FROM users WHERE name LIKE $1)`, [`drill_%_${stamp}`]).catch(() => undefined);
  await killServer().catch(() => undefined);
  await db.end();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
