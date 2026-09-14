/**
 * Server-sent events: how an open tab hears that the league moved.
 *
 * Without this a client has two bad options. Poll every few seconds and most
 * requests hand back a league nobody changed — eight GMs each re-downloading
 * a multi-megabyte document to learn nothing. Or don't poll, and a GM sits
 * on a trade screen for ten minutes after the offer they're looking at was
 * withdrawn.
 *
 * So the server tells them. The frame is deliberately small: a version
 * number and the one-line summaries of what happened. It is *not* the league
 * — pushing a whole `LeagueState` down an idle connection every time
 * somebody signs a punter would be worse than the polling it replaces. The
 * client compares versions and pulls if it cares.
 *
 * Two things deliver a change, and both are here on purpose:
 *
 *   - An in-process hook fires the instant a `withLeague` transaction
 *     commits. This is the path that actually runs, and it is immediate.
 *   - A slow poll of `league_state.version` covers the case the hook can't
 *     see: a second server process, or the migration/admin console, changing
 *     a league this process is watching. It costs one small indexed query
 *     every few seconds *only while somebody is watching*, regardless of how
 *     many watchers there are.
 *
 * `LISTEN`/`NOTIFY` would replace the second one and is the more elegant
 * answer, but it wants a dedicated connection with its own reconnect story.
 * For a league where the interesting events are hours apart, a five-second
 * floor on cross-process news is not a real cost, and this has no moving
 * parts to get wrong.
 */
import type { ServerResponse } from "node:http";

import { onLeagueCommit, pool } from "./db.js";
import { feed } from "./inbox.js";

/** How often to check for changes this process didn't make itself. */
const POLL_MS = Number(process.env.STREAM_POLL_MS ?? 5_000);
/** Comment frames, so proxies and load balancers don't reap an idle stream. */
const HEARTBEAT_MS = 25_000;

interface Watcher {
  res: ServerResponse;
  userId: string;
}

interface Watched {
  watchers: Set<Watcher>;
  /** Highest event id already sent, so a change only ships what's new. */
  lastEventId: number;
  /** Last version this process announced, to suppress repeats. */
  lastVersion: string;
}

const watched = new Map<string, Watched>();
let ticker: NodeJS.Timeout | null = null;

function frame(res: ServerResponse, event: string, data: unknown): void {
  // one `\n\n` terminates a frame; anything less and the client buffers
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Send one league's news to everyone watching it. */
async function broadcast(leagueId: string, version: string): Promise<void> {
  const w = watched.get(leagueId);
  if (!w || w.watchers.size === 0) return;
  if (w.lastVersion === version) return;
  w.lastVersion = version;

  // the summaries are the nicety; the version is the news. If the feed read
  // fails we still tell the client something moved rather than nothing.
  const fresh = await feed(leagueId, w.lastEventId)
    .then((rows) => rows.reverse())
    .catch(() => []);
  for (const e of fresh) w.lastEventId = Math.max(w.lastEventId, Number(e.id));

  const payload = {
    version,
    events: fresh.map((e) => ({
      id: e.id,
      kind: e.kind,
      summary: e.summary,
      teamCode: e.teamCode,
      at: e.at,
    })),
  };
  for (const watcher of w.watchers) frame(watcher.res, "change", payload);
}

/** The cross-process safety net; runs only while something is watched. */
async function poll(): Promise<void> {
  const ids = [...watched.keys()];
  if (ids.length === 0) return;
  const rows = await pool.query<{ league_id: string; version: string }>(
    `SELECT league_id, version FROM league_state WHERE league_id = ANY($1)`,
    [ids],
  );
  for (const row of rows.rows) await broadcast(row.league_id, row.version);
}

function startTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => void poll().catch(() => {}), POLL_MS);
  ticker.unref();
}

function stopTicker(): void {
  if (ticker && watched.size === 0) {
    clearInterval(ticker);
    ticker = null;
  }
}

// The fast path. A commit in this process reaches watchers immediately;
// the poll above exists for the commits that happen somewhere else.
onLeagueCommit((leagueId, version) => void broadcast(leagueId, version).catch(() => {}));

/**
 * Register one already-open response as a watcher.
 *
 * Split out from `openStream` because everything interesting about a stream
 * — who gets a frame, what counts as a repeat, what happens when the last
 * watcher leaves — is decided here and needs no database to decide.
 * `openStream` is only the part that has to ask Postgres where the league
 * currently is.
 *
 * Returns the close function; the caller wires it to whatever means the
 * client went away.
 */
export function attachWatcher(
  res: ServerResponse,
  leagueId: string,
  userId: string,
  seed: { version: string; lastEventId: number },
): () => void {
  let entry = watched.get(leagueId);
  if (!entry) {
    entry = { watchers: new Set(), lastEventId: seed.lastEventId, lastVersion: seed.version };
    watched.set(leagueId, entry);
  }
  const watcher: Watcher = { res, userId };
  entry.watchers.add(watcher);
  startTicker();

  // `retry` is the browser's reconnect delay; EventSource handles the rest
  res.write(`retry: 3000\n\n`);
  frame(res, "hello", { version: seed.version });

  const beat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS);
  beat.unref();

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    const w = watched.get(leagueId);
    if (!w) return;
    w.watchers.delete(watcher);
    if (w.watchers.size === 0) watched.delete(leagueId);
    stopTicker();
  };
  res.on("close", close);
  return close;
}

/**
 * Attach one client to one league's stream.
 *
 * Returns once the stream is open. The response stays open until the client
 * goes away, which is the point — so the caller must not write to it after.
 */
export async function openStream(
  res: ServerResponse,
  leagueId: string,
  userId: string,
  onClose: (fn: () => void) => void,
): Promise<void> {
  // both reads happen before the headers go out, so a database failure is
  // still a plain JSON error rather than a half-open stream
  const current = await pool.query<{ version: string }>(
    `SELECT version FROM league_state WHERE league_id = $1`,
    [leagueId],
  );
  const top = await pool.query<{ max: string | null }>(
    `SELECT max(id) AS max FROM events WHERE league_id = $1`,
    [leagueId],
  );

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // nginx buffers text/* by default, which would hold every frame back
    "x-accel-buffering": "no",
  });

  onClose(
    attachWatcher(res, leagueId, userId, {
      version: current.rows[0]?.version ?? "0",
      lastEventId: Number(top.rows[0]?.max ?? 0),
    }),
  );
}

/** How many clients this process is holding open, for tests and diagnostics. */
export function watcherCount(leagueId?: string): number {
  if (leagueId) return watched.get(leagueId)?.watchers.size ?? 0;
  let n = 0;
  for (const w of watched.values()) n += w.watchers.size;
  return n;
}

/** Deliver a change to watchers directly, as a commit in this process does. */
export async function announce(leagueId: string, version: string): Promise<void> {
  await broadcast(leagueId, version);
}
