import type { Page } from "@playwright/test";

import { SAVE_KEY } from "./test.ts";

/** What the saved league says about free agency and the human GM's choices, read in the page. */
export interface SavedMarket {
  stage: string;
  season: number | null;
  /** The viewer's team code. */
  me: string | null;
  /** The viewer GM's "sit this stage out" choices, as saved. */
  skips: { freeAgency?: boolean; tradeDeadline?: boolean };
  /** The turn-based market, or null when none is open or kept. */
  event: null | {
    round: number;
    complete: boolean;
    /** The team whose turn it is, or null when nobody's is. */
    onTheClock: string | null;
    /** Offers the viewer's team has made, across every round. */
    myOffers: number;
    signed: number;
  };
  /** Players on the viewer's roster who have not retired. */
  rosterCount: number;
}

/** Reads the league the app has saved in this browser, reduced to the free-agency fields. Parsed in the page. */
export async function readMarket(page: Page): Promise<SavedMarket | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const s = (JSON.parse(raw) as { state: Record<string, any> }).state;
    const gm = (s.gms as Array<{ id: string; teamCode?: string; skips?: { freeAgency?: boolean; tradeDeadline?: boolean } }>).find((g) => g.id === s.viewerGmId);
    const me = gm?.teamCode ?? null;
    const e = s.freeAgencyEvent as null | { round: number; complete: boolean; order: string[]; turnIndex: number; offers: Record<string, Array<{ teamCode: string }>>; signed: unknown[] };
    const players = Object.values(s.players as Record<string, { nfl_team: string | null; retired?: boolean }>);
    return {
      stage: s.stage as string,
      season: (s.season ?? null) as number | null,
      me,
      skips: gm?.skips ?? {},
      event: e
        ? {
            round: e.round,
            complete: e.complete,
            onTheClock: e.complete ? null : (e.order[e.turnIndex] ?? null),
            myOffers: Object.values(e.offers).flat().filter((o) => o.teamCode === me).length,
            signed: e.signed.length,
          }
        : null,
      rosterCount: me ? players.filter((p) => p.nfl_team === me && !p.retired).length : 0,
    };
  }, SAVE_KEY);
}
