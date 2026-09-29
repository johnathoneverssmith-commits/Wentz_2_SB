import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { franchiseOf } from "../src/auth.js";
import { migrate, pool } from "../src/db.js";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";

import { attachWatcher, pruneWatchers } from "../src/stream.js";
import { archiveLeague, claimTeam, createOnlineLeague, leagueByInvite, leaguesFor, leaveLeague, openTeams, vacateSeat } from "../src/leagues.js";

/**
 * A GM quits. There was no way to replace them: the league waited a full
 * phase clock on the empty chair at every stage, forever, and nobody new
 * could take the team. The commissioner can now hand it to the CPU and open
 * the seat under the league's invite code.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`vac_comm_${stamp}`, `vac_quit_${stamp}`, `vac_new_${stamp}`] as const;
let leagueId = "";

beforeAll(async () => {
  if (!url) return;
  try {
    await pool.query("SELECT 1");
    await migrate();
    reachable = true;
  } catch {
    reachable = false;
  }
  if (!reachable) return;
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
       VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [u],
    );
  }
  leagueId = (await createOnlineLeague(users[0], { name: "Vacate Test", humanSlots: 2 })).leagueId;
  await claimTeam(leagueId, users[0], "GB");
  await claimTeam(leagueId, users[1], "KC");
});

afterAll(async () => {
  if (reachable) {
    await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => {});
    for (const u of users) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  });

const stateOf = async () =>
  (await pool.query<{ state: LeagueState }>(`SELECT state FROM league_state WHERE league_id = $1`, [leagueId]))
    .rows[0]!.state;

describe("reopening a seat", () => {
  maybe("is the commissioner's to do, and not to their own team", async () => {
    await expect(vacateSeat(leagueId, users[0], "GB")).rejects.toThrow(/your own team/);
    await expect(vacateSeat(leagueId, users[0], "DAL")).rejects.toThrow(/Nobody holds/);
  });

  maybe("hands the team to the CPU and lists it as open", async () => {
    await vacateSeat(leagueId, users[0], "KC");
    expect(await franchiseOf(leagueId, users[1])).toBeNull();
    const s = await stateOf();
    const gm = s.gms.find((g) => g.teamCode === "KC")!;
    expect(gm.isHuman, "the league must stop waiting on them").toBe(false);
    expect(s.teams.KC!.controlledBy.kind).toBe("ai");
    expect(await openTeams(leagueId)).toEqual(["KC"]);
  });

  maybe("lets a newcomer take over that team", async () => {
    const claimed = await claimTeam(leagueId, users[2], "KC");
    expect(claimed.teamCode).toBe("KC");
    const s = await stateOf();
    const gm = s.gms.find((g) => g.id === claimed.gmId)!;
    expect(gm.isHuman).toBe(true);
    expect(gm.name).toBe(users[2]);
    expect(s.teams.KC!.controlledBy).toEqual({ kind: "human", gmId: claimed.gmId });
    expect(await openTeams(leagueId)).toEqual([]);
  });
});

describe("leaving, and archiving", () => {
  maybe("a GM can leave: their seat opens and the CPU takes the team", async () => {
    await leaveLeague(leagueId, users[2]);
    expect(await franchiseOf(leagueId, users[2])).toBeNull();
    expect(await openTeams(leagueId)).toEqual(["KC"]);
  });

  maybe("finds the league from a code pasted with spaces, dashes or quotes", async () => {
    const code = (await pool.query<{ invite_code: string }>(`SELECT invite_code FROM leagues WHERE id = $1`, [leagueId])).rows[0]!.invite_code;
    const messy = ` "${code.slice(0, 4).toLowerCase()}-${code.slice(4)}" `;
    expect((await leagueByInvite(messy))?.id).toBe(leagueId);
  });

  maybe("counts the reopened seat, so the lobby knows the invite code matters again", async () => {
    const row = (await leaguesFor(users[0])).find((l) => l.id === leagueId);
    expect(row?.openSeats).toBe(1);
  });

  maybe("closes the stream of a GM who is no longer in the league", async () => {
    class Res extends EventEmitter {
      ended = false;
      write(): boolean {
        return true;
      }
      end(): void {
        this.ended = true;
        this.emit("close");
      }
    }
    const gone = new Res();
    const stays = new Res();
    const closeGone = attachWatcher(gone as unknown as ServerResponse, leagueId, users[1], { version: "1", lastEventId: 0 });
    const closeStays = attachWatcher(stays as unknown as ServerResponse, leagueId, users[0], { version: "1", lastEventId: 0 });
    try {
      // users[1]'s seat was reopened above
      expect(await pruneWatchers(leagueId)).toBe(1);
      expect(gone.ended).toBe(true);
      expect(stays.ended).toBe(false);
    } finally {
      closeGone();
      closeStays();
    }
  });

  maybe("the commissioner can't leave the league without anyone to run it", async () => {
    await expect(leaveLeague(leagueId, users[0])).rejects.toThrow(/commissioner/);
  });

  maybe("only the commissioner archives, and it leaves every lobby", async () => {
    await expect(archiveLeague(leagueId, users[1])).rejects.toThrow(/commissioner/);
    await archiveLeague(leagueId, users[0]);
    expect((await leaguesFor(users[0])).some((l) => l.id === leagueId)).toBe(false);
    const code = (await pool.query<{ invite_code: string }>(`SELECT invite_code FROM leagues WHERE id = $1`, [leagueId])).rows[0]!.invite_code;
    expect(await leagueByInvite(code)).toBeNull();
  });
});
