/**
 * Second half of the multiplayer journey: run AFTER the league server was restarted (kill it, start it again on
 * the same disposable database). Signs the three journey GMs back in, checks the league survived byte-for-byte
 * where it should, then races real draft requests.
 *
 *   BASE_URL=http://127.0.0.1:8790 JOURNEY_STATE=<file from the journey> node online/dev/multiplayer-restart-check.mjs
 * Loopback only.
 */
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8790";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error("refused: loopback only");
  process.exit(2);
}
const saved = JSON.parse(readFileSync(process.env.JOURNEY_STATE ?? "/tmp/journey-state.json", "utf8"));
let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) failures++;
};

async function login(name) {
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, password: "password123" }),
  });
  const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return { name, r, cookie };
}
const call = async (g, method, path, body) => {
  const r = await fetch(`${BASE}/leagues/${saved.L}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: g.cookie },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let j = null;
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};

const gms = [];
for (const n of saved.users) gms.push(await login(n));
check(gms.every((g) => g.r.status === 200 && g.cookie), "after the restart all three GMs sign back in (accounts persisted)");
const after = await call(gms[0], "GET", "");
check(after.body.version === saved.version, `league version survived the restart (${saved.version})`);
check(after.body.state.stage === saved.stage, `league stage survived the restart (${saved.stage})`);

// the pause survived the restart: still paused, still refusing, then the commissioner (only) lifts it
check(after.body.state.pause?.by !== undefined, "the pause survived the restart");
const stillRefused = await call(gms[1], "POST", "/actions/ready", { ready: true, stage: saved.stage });
check(stillRefused.status === 423, `a paused league still refuses after a restart (${stillRefused.status})`);
check((await call(gms[1], "POST", "/admin/resume", {})).status === 403, "a non-commissioner cannot resume after the restart");
const feedRows = (await call(gms[0], "GET", "/feed")).body.events.map((e) => e.kind);
check(feedRows.includes("league.paused"), "the pause is in the league feed after the restart");
const resumes = await Promise.all([call(gms[0], "POST", "/admin/resume", {}), call(gms[0], "POST", "/admin/resume", {})]);
check(resumes.map((r) => r.status).sort().join() === "200,409", `two simultaneous resumes after a restart apply once (${resumes.map((r) => r.status)})`);
const running = (await call(gms[0], "GET", "")).body;
check(!running.state.pause && running.state.stage === saved.stage, "resumed: running again, same stage");
const st = running.state;

// who is on the clock?
if (st.draft) {
  const onClock = st.draft.pickOrder[st.draft.currentPickIndex];
  const clockGm = gms.find((_, i) => true);
  const mine = await Promise.all(gms.map(async (g) => ({ g, me: (await call(g, "GET", "")).body })));
  const owner = mine.find((m) => (m.me.you?.teamCode ?? m.me.franchise?.teamCode) === onClock);
  const other = mine.find((m) => m !== owner && (m.me.you?.teamCode ?? m.me.franchise?.teamCode));
  const pickable = Object.values(st.players).filter((p) => p.nfl_team === "FA" || p.nflTeam === "FA" || !p.nfl_team)[0];
  const playerId = st.draft.available?.[0] ?? pickable?.id;
  console.log(`on the clock: ${onClock}${owner ? " (a human GM)" : " (CPU)"}; candidate ${playerId}`);
  if (owner && playerId) {
    // a version-guarded action (trades/bids/signings) with a token from before the restart is refused and applies
    // nothing. (Draft picks carry no version by design: they are gated by whose turn it is — see actions.ts.)
    const staleTok = await call(owner.g, "POST", "/actions/trade/propose", { toTeam: "DAL", give: [], get: [], version: "1" });
    check(staleTok.status === 409, `a stale version token on a guarded action is refused (${staleTok.status})`);
    const intruder = await call(other.g, "POST", "/actions/draft/pick", { selectedId: playerId });
    check(intruder.status >= 400 && intruder.status < 500, `a GM not on the clock cannot pick for the on-clock team (${intruder.status})`);
    const raced = await Promise.all([1, 2, 3].map(() => call(owner.g, "POST", "/actions/draft/pick", { selectedId: playerId })));
    const ok = raced.filter((r) => r.status === 200).length;
    check(ok === 1, `three simultaneous identical picks: exactly one applied (${raced.map((r) => r.status + (r.status !== 200 ? ' ' + JSON.stringify(r.body) : '')).join(' | ')})`);
    const final = (await call(gms[0], "GET", "")).body.state;
    const owners = Object.values(final.players).filter((p) => p.id === playerId);
    check(owners.length === 1, "the drafted player exists once");
    const results = final.draft?.results ?? [];
    check(results.filter((x) => x.playerId === playerId || x.selectedId === playerId).length <= 1, "the player appears in the draft results at most once");
  } else {
    console.log("(no human on the clock first; draft race skipped)");
  }
}
console.log(failures === 0 ? "RESTART CHECK OK" : `RESTART CHECK FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
