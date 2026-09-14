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

import { pool } from "./db.js";

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

/**
 * The handful of facts the inbox actually needs from a league.
 *
 * Worth naming, because the inbox used to read the whole `LeagueState` to get
 * them — 1.4MB of JSON per league, per visit, to answer five small questions,
 * one of which is a count. A GM in four leagues pulled ~6MB out of Postgres
 * and parsed it just to render a to-do list. Postgres can answer all of this
 * from inside the document instead and hand back a few hundred bytes.
 */
export interface InboxFacts {
  onTheClock: boolean;
  /** 1-based, for display; 0 when not drafting. */
  pickNumber: number;
  draftMode: string | null;
  offeredBy: string[];
  ready: boolean;
  capUsed: number;
  capTotal: number;
  rosterCount: number;
}

/** The same facts, taken from a state already in hand. Keeps the rules honest. */
export function factsFromState(
  state: LeagueState,
  teamCode: string,
  gmId: string,
): InboxFacts {
  const draft = state.draft;
  const onTheClock = !!draft && draft.pickOrder[draft.currentPickIndex] === teamCode;
  const cap = state.teams[teamCode]?.cap;
  return {
    onTheClock,
    pickNumber: draft ? draft.currentPickIndex + 1 : 0,
    draftMode: draft?.mode ?? null,
    offeredBy: state.trades
      .filter((t) => t.status === "offered" && t.toTeam === teamCode)
      .map((t) => t.fromTeam),
    ready: !!state.readiness[gmId],
    capUsed: cap?.used ?? 0,
    capTotal: cap?.total ?? 0,
    rosterCount: Object.values(state.players).filter(
      (p) => p.nfl_team === teamCode && !p.retired && !p.free_agent,
    ).length,
  };
}

/**
 * The same facts, without pulling the document out of the database.
 *
 * Every expression here runs inside Postgres against the JSONB, so what comes
 * back over the wire is one small row rather than the league.
 */
export async function inboxFacts(
  leagueId: string,
  teamCode: string,
  gmId: string,
): Promise<InboxFacts | null> {
  const rows = await pool.query<{
    on_the_clock: boolean;
    pick_number: number;
    draft_mode: string | null;
    offered_by: string[] | null;
    ready: boolean;
    cap_used: string | null;
    cap_total: string | null;
    roster_count: string;
  }>(
    `SELECT
       COALESCE(s.state->'draft'->'pickOrder'->>((s.state->'draft'->>'currentPickIndex')::int), '')
         = $2                                                           AS on_the_clock,
       COALESCE((s.state->'draft'->>'currentPickIndex')::int + 1, 0)    AS pick_number,
       s.state->'draft'->>'mode'                                        AS draft_mode,
       ARRAY(
         SELECT t->>'fromTeam' FROM jsonb_array_elements(s.state->'trades') AS t
          WHERE t->>'status' = 'offered' AND t->>'toTeam' = $2
       )                                                                AS offered_by,
       COALESCE((s.state->'readiness'->>$3)::boolean, false)            AS ready,
       s.state->'teams'->$2->'cap'->>'used'                             AS cap_used,
       s.state->'teams'->$2->'cap'->>'total'                            AS cap_total,
       (SELECT count(*) FROM jsonb_each(s.state->'players') AS p(k, v)
         WHERE v->>'nfl_team' = $2
           AND NOT COALESCE((v->>'retired')::boolean, false)
           AND NOT COALESCE((v->>'free_agent')::boolean, false))        AS roster_count
     FROM league_state s WHERE s.league_id = $1`,
    [leagueId, teamCode, gmId],
  );
  const r = rows.rows[0];
  if (!r) return null;
  return {
    onTheClock: r.on_the_clock,
    pickNumber: r.pick_number,
    draftMode: r.draft_mode,
    offeredBy: r.offered_by ?? [],
    ready: r.ready,
    capUsed: Number(r.cap_used ?? 0),
    capTotal: Number(r.cap_total ?? 0),
    rosterCount: Number(r.roster_count),
  };
}

function itemsFor(facts: InboxFacts): InboxItem[] {
  const items: InboxItem[] = [];

  // on the clock — the only thing that genuinely stops the league
  if (facts.onTheClock) {
    items.push({
      kind: "draft",
      title: "You're on the clock.",
      detail: `Pick ${facts.pickNumber} of the ${facts.draftMode === "rookie" ? "rookie" : "fantasy"} draft.`,
      href: "/draft",
      urgency: "now",
    });
  }

  for (const fromTeam of facts.offeredBy) {
    items.push({
      kind: "trade",
      title: `${city(fromTeam)} have offered you a trade.`,
      href: "/trade",
      urgency: "soon",
    });
  }

  if (!facts.ready) {
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
  if (facts.capTotal > 0 && facts.capUsed > facts.capTotal) {
    items.push({
      kind: "roster",
      title: `You're $${(facts.capUsed - facts.capTotal).toFixed(1)}M over the cap.`,
      detail: "Release, restructure or trade before the preseason, or your staff will.",
      href: "/roster",
      urgency: "whenever",
    });
  }
  if (facts.rosterCount > 53) {
    items.push({
      kind: "roster",
      title: `You're carrying ${facts.rosterCount} players.`,
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
    // name/season/stage/deadline are all denormalised columns — the reason
    // they exist is so this screen never has to open the document
    const head = await pool.query<{
      name: string;
      season: number;
      stage: string;
      phase_ends_at: Date | null;
    }>(
      `SELECT l.name, s.season, s.stage, s.phase_ends_at
         FROM leagues l JOIN league_state s ON s.league_id = l.id
        WHERE l.id = $1 AND l.archived_at IS NULL`,
      [row.league_id],
    );
    const h = head.rows[0];
    if (!h) continue;
    const facts = await inboxFacts(row.league_id, row.team_code, row.gm_id);
    if (!facts) continue;
    out.push({
      leagueId: row.league_id,
      leagueName: h.name,
      teamCode: row.team_code,
      season: h.season,
      stage: h.stage,
      msLeft: h.phase_ends_at ? Math.max(0, h.phase_ends_at.getTime() - Date.now()) : null,
      items: itemsFor(facts),
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
