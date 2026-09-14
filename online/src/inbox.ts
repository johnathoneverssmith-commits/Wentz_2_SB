/**
 * What is waiting on you.
 *
 * This is the screen asynchronous play lives or dies on. A GM opens the app
 * after four days; the question they have is not "what is the state of the
 * league" but "what do I need to do, and by when". Everything here answers
 * that, and nothing here is a summary of what the league is doing without
 * them — that's the event feed's job.
 */
import type { LeagueState } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";

import { pool, readLeague } from "./db.js";

export interface InboxItem {
  kind: "draft" | "trade" | "ready" | "roster";
  /** What to do, in the imperative, from the GM's side of the screen. */
  title: string;
  detail?: string;
  /** Client route that does something about it. */
  href: string;
  /** Ordering: an expiring draft clock outranks a roster nag. */
  urgency: "now" | "soon" | "whenever";
}

export interface Inbox {
  leagueId: string;
  leagueName: string;
  teamCode: string;
  season: number;
  stage: string;
  /** Milliseconds until this phase closes without you, or null if untimed. */
  msLeft: number | null;
  items: InboxItem[];
}

const city = (code: string): string => TEAMS_BY_CODE[code]?.label ?? code;

function itemsFor(state: LeagueState, teamCode: string, gmId: string): InboxItem[] {
  const items: InboxItem[] = [];

  // on the clock — the only thing that genuinely stops the league
  const draft = state.draft;
  if (draft && draft.pickOrder[draft.currentPickIndex] === teamCode) {
    items.push({
      kind: "draft",
      title: "You're on the clock.",
      detail: `Pick ${draft.currentPickIndex + 1} of the ${draft.mode === "rookie" ? "rookie" : "fantasy"} draft.`,
      href: "/draft",
      urgency: "now",
    });
  }

  for (const t of state.trades) {
    if (t.status !== "offered" || t.toTeam !== teamCode) continue;
    items.push({
      kind: "trade",
      title: `${city(t.fromTeam)} have offered you a trade.`,
      href: "/trade",
      urgency: "soon",
    });
  }

  if (!state.readiness[gmId]) {
    items.push({
      kind: "ready",
      title: "The league is waiting on you to move on.",
      detail: "Everyone else has to wait, or the clock runs out and your staff decides.",
      href: "/",
      urgency: "soon",
    });
  }

  // an illegal roster gets fixed for you at the gate, which is worse than
  // fixing it yourself — so say so while there's still time
  const roster = Object.values(state.players).filter(
    (p) => p.nfl_team === teamCode && !p.retired && !p.free_agent,
  );
  const cap = state.teams[teamCode]?.cap;
  if (cap && cap.used > cap.total) {
    items.push({
      kind: "roster",
      title: `You're $${(cap.used - cap.total).toFixed(1)}M over the cap.`,
      detail: "Release, restructure or trade before the preseason, or your staff will.",
      href: "/roster",
      urgency: "whenever",
    });
  }
  if (roster.length > 53) {
    items.push({
      kind: "roster",
      title: `You're carrying ${roster.length} players.`,
      detail: "The limit is 53 once the season starts.",
      href: "/roster",
      urgency: "whenever",
    });
  }

  const rank = { now: 0, soon: 1, whenever: 2 };
  return items.sort((a, b) => rank[a.urgency] - rank[b.urgency]);
}

/** Every league this user is in, and what each one needs from them. */
export async function inboxFor(userId: string): Promise<Inbox[]> {
  const rows = await pool.query<{ league_id: string; team_code: string; gm_id: string }>(
    `SELECT league_id, team_code, gm_id FROM franchises
      WHERE user_id = $1 AND team_code NOT LIKE 'unclaimed:%'`,
    [userId],
  );
  const out: Inbox[] = [];
  for (const row of rows.rows) {
    const loaded = await readLeague(row.league_id);
    if (!loaded) continue;
    out.push({
      leagueId: row.league_id,
      leagueName: loaded.league.name,
      teamCode: row.team_code,
      season: loaded.state.season,
      stage: loaded.state.stage,
      msLeft: loaded.phaseEndsAt ? Math.max(0, loaded.phaseEndsAt.getTime() - Date.now()) : null,
      items: itemsFor(loaded.state, row.team_code, row.gm_id),
    });
  }
  // the league that needs something now comes first
  return out.sort((a, b) => {
    const urgent = (x: Inbox) => (x.items[0]?.urgency === "now" ? 0 : x.items.length ? 1 : 2);
    return urgent(a) - urgent(b) || (a.msLeft ?? Infinity) - (b.msLeft ?? Infinity);
  });
}

/**
 * What happened while you were away.
 *
 * Deliberately the league's own words rather than a diff: every action wrote
 * a one-line summary when it was applied, so this is just reading them back.
 */
export async function feed(leagueId: string, sinceId = 0, limit = 50): Promise<
  { id: string; at: Date; kind: string; summary: string; teamCode: string | null }[]
> {
  const rows = await pool.query(
    `SELECT id, at, kind, summary, team_code FROM events
      WHERE league_id = $1 AND id > $2
      ORDER BY id DESC LIMIT $3`,
    [leagueId, sinceId, Math.min(200, limit)],
  );
  return rows.rows.map((r) => ({
    id: String(r.id),
    at: r.at,
    kind: r.kind,
    summary: r.summary,
    teamCode: r.team_code,
  }));
}
