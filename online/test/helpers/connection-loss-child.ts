/**
 * Child process for reliability-audit.test.ts: loses its database connection
 * in the middle of a league transaction and reports whether it lived.
 * Run only by that test, against the throwaway database it was given.
 */
import { pool, withLeague } from "../../src/db.js";
import { createOnlineLeague } from "../../src/leagues.js";

const user = `loss_${process.pid}`;
await pool.query(
  `INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y')`,
  [user],
);
const { leagueId } = await createOnlineLeague(user, { name: "Connection loss" });
await withLeague(leagueId, async ({ state }, client) => {
  const pid = (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
  await pool.query("SELECT pg_terminate_backend($1)", [pid]);
  return { result: null, state };
}).catch(() => undefined); // the action failing is fine: that is the correct outcome
await new Promise((r) => setTimeout(r, 1000));
console.log("SURVIVED");
await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]);
await pool.query(`DELETE FROM users WHERE id = $1`, [user]);
await pool.end();
