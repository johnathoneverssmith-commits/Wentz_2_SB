/**
 * A controlled stand-in for the league server, for the online screens. Every request to the (unreachable) league API
 * address is answered here from data this test supplies; nothing is persisted and no real server, database or account is
 * contacted. It extends e2e/support/controlled-league.ts with the knobs the audit needs: who the viewer is, whether they
 * are the commissioner, who the league is waiting on, and how each call behaves (slow, refused, or dropped).
 */
import type { Page } from "@playwright/test";

export interface OnlineOptions {
  you: { teamCode: string; gmId: string };
  isCommissioner?: boolean;
  inviteCode?: string | null;
  msLeft?: number | null;
  waitingOn?: string[];
  canClaimCommissioner?: boolean;
  leagueName?: string;
  /** Delay every league load by this long (a loading state). */
  loadDelayMs?: number;
  /** Fail the league load with this status. */
  loadStatus?: number;
}

export const LEAGUE_ID = "audit-controlled";

export async function onlineLeague(page: Page, origin: string, initial: Record<string, any>, opts: OnlineOptions) {
  const state = initial;
  const requests: Array<{ path: string; payload: unknown }> = [];
  const unexpected: string[] = [];
  const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
  await page.route("http://127.0.0.1:9/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path.includes("/actions/")) {
      requests.push({ path, payload: request.postDataJSON() });
      return route.fulfill({ status: 403, headers, json: { error: "Audit transport: actions are not accepted." } });
    }
    if (path.endsWith("/stream")) return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/event-stream" }, body: ": audit stream\n\n" });
    if (path.endsWith("/feed")) return route.fulfill({ headers, json: { events: [] } });
    if (path.endsWith("/plan-preview")) return route.fulfill({ status: 503, headers, json: { error: "No engine in the audit transport." } });
    if (path === `/leagues/${LEAGUE_ID}`) {
      if (opts.loadDelayMs) await new Promise((r) => setTimeout(r, opts.loadDelayMs));
      if (opts.loadStatus) return route.fulfill({ status: opts.loadStatus, headers, json: { error: "Audit transport: forced failure." } });
      return route.fulfill({
        headers,
        json: {
          league: { id: LEAGUE_ID, name: opts.leagueName ?? "Audit league" },
          state,
          version: "audit-version",
          you: opts.you,
          isCommissioner: opts.isCommissioner ?? false,
          inviteCode: opts.isCommissioner ? (opts.inviteCode ?? "AUDIT1") : null,
          msLeft: opts.msLeft ?? null,
          waitingOn: opts.waitingOn ?? [],
          canClaimCommissioner: opts.canClaimCommissioner ?? false,
        },
      });
    }
    unexpected.push(path);
    return route.fulfill({ status: 404, headers, json: { error: `Unexpected audit endpoint: ${path}` } });
  });
  // put the solo save where the online client reads it, and point at this league, then reload into it
  await page.evaluate(
    ([id]) => {
      const solo = localStorage.getItem("nfl-sim-ui.league");
      if (solo) localStorage.setItem("nfl-sim-ui.online-league", solo);
      localStorage.setItem("fs.online.leagueId", id!);
    },
    [LEAGUE_ID],
  );
  return { requests, unexpected, state };
}

/** Adds a second human GM on `teamCode` (a copy of the viewer's GM, renamed), so a turn can belong to someone else. */
export function addOtherHuman(state: Record<string, any>, teamCode: string, name = "Taylor Okafor"): string {
  const owner = (state.gms as Array<Record<string, any>>).find((g) => g.id === state.viewerGmId)!;
  const id = "audit_gm_2";
  // the CPU GM that held the seat, if any, is replaced rather than duplicated
  state.gms = (state.gms as Array<Record<string, any>>).filter((g) => g.teamCode !== teamCode || g.id === state.viewerGmId);
  state.gms.push({ ...owner, id, name, teamCode, isHuman: true });
  return id;
}

interface Clock {
  order: string[];
  get: () => number;
  set: (i: number) => void;
}

/** The turn pointer of whichever turn-based event the saved league is in, or null when it is in none. */
function clockOf(state: Record<string, any>): Clock | null {
  const stage = state.stage as string;
  if (stage === "coachingDraft" && state.coachingDraft) {
    const d = state.coachingDraft;
    return { order: d.pickOrder, get: () => d.currentPickIndex, set: (i) => (d.currentPickIndex = i) };
  }
  if ((stage === "fantasyDraft" || stage === "offseasonDraft") && state.draft) {
    const d = state.draft;
    return { order: d.pickOrder, get: () => d.currentPickIndex, set: (i) => (d.currentPickIndex = i) };
  }
  if (stage === "tradeDeadline" && state.tradeDeadline) {
    const d = state.tradeDeadline;
    return { order: d.order, get: () => d.index, set: (i) => (d.index = i) };
  }
  if (/FreeAgency$/.test(stage) && state.freeAgencyEvent) {
    const e = state.freeAgencyEvent;
    return { order: e.order, get: () => e.turnIndex, set: (i) => (e.turnIndex = i) };
  }
  return null;
}

/** The team whose turn it is, per the saved state. */
export function onTheClock(state: Record<string, any>): string | undefined {
  const c = clockOf(state);
  return c ? c.order[c.get()] : undefined;
}

/**
 * Makes the turn belong to a team other than the viewer's by moving the pointer to the next other team in the order
 * (in memory only, in the throwaway browser context). Returns that team, or undefined if the event has none.
 * The audit needs "someone else is holding things up", which is when the commissioner's control appears.
 */
export function moveClockOffViewer(state: Record<string, any>, viewerTeam: string): string | undefined {
  const c = clockOf(state);
  if (!c) return undefined;
  for (let i = c.get(); i < c.order.length; i++) {
    if (c.order[i] !== viewerTeam) {
      c.set(i);
      return c.order[i];
    }
  }
  return undefined;
}
