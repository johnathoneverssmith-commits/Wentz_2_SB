/**
 * Measures what a league costs on the wire and in the database: payload sizes, poll cost, latency under a
 * concurrent poll storm, and the server's memory. Loopback + a disposable database only.
 *   BASE_URL=http://127.0.0.1:8791 PG_URL=postgres://postgres@127.0.0.1:5440/wentz_perf_test node online/dev/multiplayer-perf-probe.mjs
 */
import { gzipSync } from "node:zlib";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8791";
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) process.exit(2);
const pool = new pg.Pool({ connectionString: process.env.PG_URL, max: 2 });
if (!/(127\.0\.0\.1|localhost)/.test(process.env.PG_URL ?? "") || !/test/.test(process.env.PG_URL ?? "")) {
  console.error("refused: PG_URL must be a local database whose name contains 'test'");
  process.exit(2);
}
const stamp = Date.now() % 1e6;
const jar = {};
async function api(who, method, path, body) {
  const t = performance.now();
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(jar[who] ? { cookie: jar[who] } : {}), "accept-encoding": "identity" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const sc = r.headers.getSetCookie?.() ?? [];
  if (sc.length) jar[who] = sc.map((c) => c.split(";")[0]).join("; ");
  const text = await r.text();
  return { status: r.status, bytes: Buffer.byteLength(text), gz: gzipSync(text).length, ms: performance.now() - t, json: text ? JSON.parse(text) : null };
}
const names = ["pa", "pb", "pc"].map((n) => n + stamp);
for (const n of names) await api(n, "POST", "/auth/register", { name: n, password: "password123" });
const created = await api(names[0], "POST", "/leagues", { name: "Perf " + stamp, humanSlots: 3 });
const L = created.json.leagueId;
const invite = (await pool.query("select invite_code from leagues where id=$1", [L])).rows[0].invite_code;
await api(names[0], "POST", `/leagues/${L}/claim`, { teamCode: "GB" });
for (const [n, t] of [[names[1], "KC"], [names[2], "DAL"]]) await api(n, "POST", `/leagues/${L}/claim`, { teamCode: t });
void invite;

const out = {};
const full = await api(names[0], "GET", `/leagues/${L}`);
out.fullState = { status: full.status, bytes: full.bytes, gzipBytes: full.gz, ms: Math.round(full.ms) };
const ver = full.json.version;
const poll = await api(names[0], "GET", `/leagues/${L}?have=${ver}`);
out.unchangedPoll = { bytes: poll.bytes, ms: Math.round(poll.ms) };
const dbsize = await pool.query("select pg_column_size(state) as stored, octet_length(state::text) as text from league_state where league_id=$1", [L]);
out.storedDocument = dbsize.rows[0];

// storm: 3 GMs x 20 concurrent polls
const q = async () => (await pool.query("select xact_commit+xact_rollback as xacts, tup_returned, tup_fetched, tup_inserted, tup_updated, blks_read from pg_stat_database where datname=current_database()")).rows[0];
const s0 = await q();
const lat = [];
const t0 = performance.now();
await Promise.all(Array.from({ length: 60 }, (_, i) => api(names[i % 3], "GET", `/leagues/${L}?have=${ver}`).then((r) => lat.push(r.ms))));
const stormMs = performance.now() - t0;
lat.sort((a, b) => a - b);
out.unchangedPollStorm60 = { totalMs: Math.round(stormMs), p50: Math.round(lat[30]), p95: Math.round(lat[57]), max: Math.round(lat[59]) };
const s1 = await q();
out.dbPer60Polls = { xacts: s1.xacts - s0.xacts, tupFetched: s1.tup_fetched - s0.tup_fetched, tupUpdated: s1.tup_updated - s0.tup_updated };

// storm of FULL reads (a client that does not send `have`)
const lat2 = [];
const t1 = performance.now();
await Promise.all(Array.from({ length: 30 }, (_, i) => api(names[i % 3], "GET", `/leagues/${L}`).then((r) => lat2.push(r.ms))));
lat2.sort((a, b) => a - b);
out.fullReadStorm30 = { totalMs: Math.round(performance.now() - t1), p50: Math.round(lat2[15]), p95: Math.round(lat2[28]), max: Math.round(lat2[29]) };

// a write (settings change) latency and the bytes rewritten
const s2 = await q();
const w = await api(names[0], "POST", `/leagues/${L}/admin/pause`, {});
const w2 = await api(names[0], "POST", `/leagues/${L}/admin/resume`, {});
out.writes = { pauseMs: Math.round(w.ms), resumeMs: Math.round(w2.ms), statuses: [w.status, w2.status], storedDocBytesRewrittenPerWrite: Number(dbsize.rows[0].text) };
const s3 = await q();
out.dbPer2Writes = { xacts: s3.xacts - s2.xacts, tupUpdated: s3.tup_updated - s2.tup_updated, tupInserted: s3.tup_inserted - s2.tup_inserted };

// 20 simultaneous writes from different GMs against one league: all serialised, none lost
const results = await Promise.all(Array.from({ length: 20 }, (_, i) => api(names[i % 3], "POST", `/leagues/${L}/actions/ready`, { ready: true, stage: "setup" })));
out.concurrentReady20 = { statuses: Object.entries(results.reduce((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {})).map(([k, v]) => `${k}x${v}`).join(" "), maxMs: Math.round(Math.max(...results.map((r) => r.ms))) };
console.log(JSON.stringify(out, null, 2));
await pool.end();
