import type { Page } from "@playwright/test";

import { readSaveText } from "./idb.ts";
import { SAVE_KEY, type SavedLeague } from "./test.ts";

/** Reads the league the app has saved in this browser, reduced to the fields the tests check. Parsed in the page. */
export async function readSave(page: Page): Promise<SavedLeague | null> {
  const stored = await readSaveText(page, SAVE_KEY);
  if (stored == null) return null;
  return page.evaluate((raw) => {
    const doc = JSON.parse(raw) as { version: number; state: Record<string, any> };
    const s = doc.state;
    const gm = (s.gms as Array<{ id: string; teamCode?: string }>).find((g) => g.id === s.viewerGmId);
    const team = gm?.teamCode ?? null;
    const players = s.players as Record<string, { name: string; nfl_team: string | null; retired?: boolean }>;
    return {
      version: doc.version,
      stage: s.stage as string,
      seed: (s.seed ?? null) as number | null,
      draftSalt: (s.draftSalt ?? null) as number | null,
      gmTeam: team,
      draft: s.draft
        ? {
            mode: s.draft.mode as string,
            currentPickIndex: s.draft.currentPickIndex as number,
            pickOrder: s.draft.pickOrder as string[],
            results: (s.draft.results as Array<{ teamCode: string; selectedId: string | null }>).map((r) => ({
              teamCode: r.teamCode,
              selectedId: r.selectedId,
              name: r.selectedId ? (players[r.selectedId]?.name ?? null) : null,
              team: r.selectedId ? (players[r.selectedId]?.nfl_team ?? null) : null,
            })),
          }
        : null,
      rosterCount: team ? Object.values(players).filter((p) => p.nfl_team === team && !p.retired).length : 0,
      bytes: raw.length,
    };
  }, stored);
}
