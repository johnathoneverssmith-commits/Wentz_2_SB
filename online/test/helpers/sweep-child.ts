/**
 * Child process for reliability-mp1.test.ts: one "server instance" running a
 * deadline sweep, started together with its siblings at START_AT (epoch ms).
 */
import { pool } from "../../src/db.js";
import { sweep } from "../../src/phases.js";

const at = Number(process.env.START_AT ?? 0);
await pool.query("SELECT 1"); // connect before the starting gun
await new Promise((r) => setTimeout(r, Math.max(0, at - Date.now())));
const out = await sweep();
console.log(`SWEPT ${JSON.stringify(out.map((o) => ({ league: o.leagueId, autopiloted: o.autopiloted })))}`);
await pool.end();
