import type { Page } from "@playwright/test";

import { SAVE_KEY } from "./test.ts";

/** One contract as the game stores it (`offerToContract` in ui-source/src/state/rules.ts). */
export interface SavedContract {
  team_id: string;
  years_remaining: number;
  total_value: number;
  guaranteed: number;
  cap_hit_by_year: number[];
  signing_bonus: number;
}

/** The viewer's team's books and the market's record, read from the league the app saved. Parsed in the page. */
export interface Ledger {
  stage: string;
  me: string;
  round: number | null;
  complete: boolean;
  onTheClock: string | null;
  /** The cap ceiling. */
  capTotal: number;
  /** The game's own rule for what a team is carrying: the first-year cap hit of every contract on its roster. */
  capUsed: number;
  /** Money carried for players no longer on the team. */
  capDead: number;
  /** Ids of the viewer's team's players who have not retired, in id order. */
  roster: string[];
  /** Every offer the viewer's team has made, in the order made. */
  offers: Array<{ playerId: string; name: string; salary: number; years: number; round: number }>;
  /** Every signing so far in this market, by anyone. */
  signed: Array<{ playerId: string; teamCode: string; salary: number; years: number; round: number }>;
}

export async function readLedger(page: Page): Promise<Ledger> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (raw == null) throw new Error("no saved league");
    const s = (JSON.parse(raw) as { state: Record<string, any> }).state;
    const gm = (s.gms as Array<{ id: string; teamCode?: string }>).find((g) => g.id === s.viewerGmId)!;
    const me = gm.teamCode as string;
    type P = { name: string; nfl_team: string | null; retired?: boolean; contract?: { cap_hit_by_year?: number[] } | null };
    const players = s.players as Record<string, P>;
    const mine = Object.entries(players).filter(([, p]) => p.nfl_team === me && !p.retired);
    const used = mine.reduce((n, [, p]) => n + (p.contract?.cap_hit_by_year?.[0] ?? 0), 0);
    const e = s.freeAgencyEvent as null | { round: number; complete: boolean; order: string[]; turnIndex: number; offers: Record<string, Array<{ teamCode: string; salary: number; years: number; round: number; sequence: number }>>; signed: Array<{ playerId: string; teamCode: string; salary: number; years: number; round: number }> };
    return {
      stage: s.stage as string,
      me,
      round: e ? e.round : null,
      complete: e ? e.complete : false,
      onTheClock: e && !e.complete ? (e.order[e.turnIndex] ?? null) : null,
      capTotal: s.teams[me].cap.total as number,
      capUsed: Math.round(used * 10) / 10,
      capDead: (s.teams[me].cap.dead ?? 0) as number,
      roster: mine.map(([id]) => id).sort(),
      offers: e
        ? Object.entries(e.offers).flatMap(([playerId, list]) =>
            list.filter((o) => o.teamCode === me).map((o) => ({ playerId, name: players[playerId]?.name ?? playerId, salary: o.salary, years: o.years, round: o.round })),
          )
        : [],
      signed: e ? e.signed.map((x) => ({ playerId: x.playerId, teamCode: x.teamCode, salary: x.salary, years: x.years, round: x.round })) : [],
    };
  }, SAVE_KEY);
}

/** One player as saved: who owns him, whether he is still a free agent, and his contract. */
export async function readPlayer(page: Page, playerId: string): Promise<{ name: string; team: string | null; freeAgent: boolean; contract: SavedContract | null }> {
  return page.evaluate(
    ([key, id]) => {
      const s = (JSON.parse(window.localStorage.getItem(key)!) as { state: Record<string, any> }).state;
      const p = s.players[id as string];
      return { name: p.name as string, team: (p.nfl_team ?? null) as string | null, freeAgent: Boolean(p.free_agent), contract: (p.contract ?? null) as SavedContract | null };
    },
    [SAVE_KEY, playerId] as const,
  );
}

/** Ids of the players the viewer's team signed in this market, from the market's own record. */
export const mySignings = (l: Ledger) => l.signed.filter((x) => x.teamCode === l.me);

/** The game's rounding for money: one decimal. */
export const tenths = (n: number): number => Math.round(n * 10) / 10;

/** How the app writes money ("$12.9M", "-$3.6M"), for comparing what is on screen with what is saved. */
export const millions = (n: number): string => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(1)}M`;
