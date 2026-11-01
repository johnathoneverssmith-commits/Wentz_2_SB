/**
 * A real-server, real-browser multiplayer journey: three independent browser contexts (three accounts, three
 * cookie jars) against a running league server and a disposable database. No mocked transport.
 *
 *   BASE_URL=http://127.0.0.1:8790 CHROMIUM=/opt/pw-browsers/chromium node online/dev/multiplayer-browser-journey.mjs
 *
 * BASE_URL must be a LOOPBACK address (refused otherwise): this registers accounts and creates a league.
 * Start the server on a disposable database first (see docs/MULTIPLAYER_RELIABILITY.md).
 */
import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8790";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`refused: BASE_URL must be loopback, got ${BASE}`);
  process.exit(2);
}
const stamp = Date.now() % 1_000_000;
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

async function gm(name) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/#/online`);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Name").fill(`${name}${stamp}`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText(`Signed in as ${name}${stamp}`).waitFor();
  return { name: `${name}${stamp}`, context, page, errors };
}

const [a, b, c] = [await gm("alice"), await gm("bob"), await gm("cara")];
check(true, "three GMs registered in three independent browser contexts");

// 1. Alice creates a human-GMs-only league for three GMs
await a.page.getByText("Start a League").first().click();
await a.page.getByLabel("League name").fill(`Journey ${stamp}`);
await a.page.getByLabel("League format").selectOption("humansOnly");
await a.page.getByLabel("Human GMs2345678").selectOption("3");
await a.page.getByRole("button", { name: "Create league" }).click();
await a.page.getByText(/Invite code:/).waitFor();
const code = (await a.page.getByText(/Invite code:/).innerText()).match(/Invite code:\s*([A-Z0-9]+)/)[1];
check(/^[A-Z0-9]{8}$/.test(code), `league created; invite code ${code}`);

// 2+3. Bob and Cara join through the invitation and pick different teams; Alice claims hers from her league
await a.page.getByRole("button", { name: /^(Claim a team in|Open) Journey/ }).first().click();
await a.page.getByRole("button", { name: "Claim Green Bay", exact: true }).click();
for (const [g, team] of [[b, "Kansas City"], [c, "Dallas"]]) {
  await g.page.getByText("Join a League").first().click();
  await g.page.getByPlaceholder("ABC12345").fill(code);
  await g.page.getByRole("button", { name: "Look it up" }).click();
  await g.page.getByRole("button", { name: `Claim ${team}`, exact: true }).click();
}
await a.page.waitForTimeout(800);
for (const g of [a, b, c]) await g.page.reload();
await a.page.waitForTimeout(800);
for (const [g, team] of [[a, "Green Bay"], [b, "Kansas City"], [c, "Dallas"]]) {
  const text = await g.page.locator("body").innerText();
  check(text.includes(team), `${g.name} sees their own team (${team}) after a reload`);
}

// 4. The server, not the browser, holds the league: all three read the same league through their own cookies
const views = [];
for (const g of [a, b, c]) {
  const list = await g.page.request.get(`${BASE}/leagues`);
  const leagues = (await list.json()).leagues ?? (await list.json());
  const lg = (Array.isArray(leagues) ? leagues : []).find((l) => l.name === `Journey ${stamp}`);
  const st = await g.page.request.get(`${BASE}/leagues/${lg.id}`);
  const body = await st.json();
  views.push({ id: lg.id, version: body.version, stage: body.state.stage, team: body.you?.teamCode ?? body.franchise?.teamCode });
}
check(new Set(views.map((v) => v.id)).size === 1, "all three GMs resolve the same league id");
check(new Set(views.map((v) => v.stage)).size === 1, `all three read the same stage (${views[0].stage})`);
check(new Set(views.map((v) => v.team)).size === 3, `three distinct teams: ${views.map((v) => v.team).join(", ")}`);

/* ---- 5. commissioner recovery + concurrency over real HTTP, each request from that GM's own cookie jar ---- */
const L = views[0].id;
const post = async (g, path, body) => {
  const r = await g.page.request.post(`${BASE}/leagues/${L}${path}`, { data: body });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status(), body: j };
};
const read = async (g) => (await (await g.page.request.get(`${BASE}/leagues/${L}`)).json());
const before = await read(a);

check((await post(b, "/admin/pause", {})).status === 403, "a non-commissioner cannot pause (403)");
check((await post(a, "/admin/pause", {})).status === 200, "the commissioner pauses the league");
const paused = await read(b);
check(paused.state.pause?.by !== undefined, "every GM sees the league as paused");
const r1 = await post(b, "/actions/ready", { ready: true, stage: before.state.stage });
check(r1.status === 423, `a GM check-in while paused is refused (423, got ${r1.status})`);
check((await post(a, "/admin/advance", { stage: before.state.stage })).status === 423, "a forced advance while paused is refused (423)");
check((await read(c)).version === paused.version, "refused requests wrote nothing (version unchanged)");
check((await post(b, "/admin/resume", {})).status === 403, "a non-commissioner cannot resume (403)");
const [res1, res2] = await Promise.all([post(a, "/admin/resume", {}), post(a, "/admin/resume", {})]);
check([res1.status, res2.status].sort().join() === "200,409", `two simultaneous resumes apply once (${res1.status}, ${res2.status})`);

// a stale client (wrong stage) and a double click
check((await post(b, "/actions/ready", { ready: true, stage: "fantasyDraft" })).status === 409, "a stale client's check-in for a different stage is refused (409)");
const dbl = await Promise.all([post(b, "/actions/ready", { ready: true, stage: before.state.stage }), post(b, "/actions/ready", { ready: true, stage: before.state.stage })]);
check(dbl.every((r) => r.status === 200 || r.status === 409), `a double-clicked check-in is harmless (${dbl.map((r) => r.status)})`);
const afterDbl = await read(b);
check(Object.values(afterDbl.state.readiness ?? {}).filter(Boolean).length <= 1, "double check-in recorded once");

// the audit trail
const feed = await (await a.page.request.get(`${BASE}/leagues/${L}/feed`)).json();
const kinds = (feed.events ?? []).map((e) => e.kind);
check(kinds.includes("league.paused") && kinds.includes("league.resumed"), "pause and resume are in the league feed");

// everyone ready: the league leaves setup exactly once
for (const g of [a, b, c]) await post(g, "/actions/ready", { ready: true, stage: before.state.stage });
const started = await read(a);
check(started.state.stage !== before.state.stage, `all three checked in: the league moved on (${before.state.stage} -> ${started.state.stage})`);
const stage2 = await read(c);
check(stage2.version === started.version && stage2.state.stage === started.state.stage, "every GM sees the same version and stage after the transition");
writeFileSync(process.env.JOURNEY_STATE ?? "/tmp/journey-state.json", JSON.stringify({ L, version: started.version, stage: started.state.stage, users: [a, b, c].map((g) => g.name) }));

for (const g of [a, b, c]) check(g.errors.length === 0, `${g.name}: no uncaught page errors${g.errors.length ? " " + g.errors[0] : ""}`);
await browser.close();
console.log(failures === 0 ? "JOURNEY OK" : `JOURNEY FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
