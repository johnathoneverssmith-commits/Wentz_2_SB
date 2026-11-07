/**
 * Variants of a saved league, applied to a COPY of the fixture's save string before it is placed in a throwaway browser
 * context. They change presentation inputs (names, reveal markers) in memory only: the fixture file on disk, the engine
 * and every rule are untouched, and no variant is ever written anywhere that survives the test.
 */

type Json = Record<string, any>;

export type VariantId = "long-text" | "partial-reveal";

export interface Variant {
  id: VariantId;
  describe: string;
  apply: (state: Json, opts: { gmId: string; team: string }) => void;
}

const LONG_SURNAME = "Featherstonehaugh-Montgomery-Wolfeschlegelstein";

export const VARIANTS: Record<VariantId, Variant> = {
  "long-text": {
    id: "long-text",
    describe: "very long human GM and player names on the viewer's roster, to stress truncation, wrapping and table columns",
    apply(state, { gmId, team }) {
      for (const g of state.gms as Json[]) if (g.id === gmId) g.name = "Bartholomew Cornelius Featherstonehaugh III, Esq.";
      let n = 0;
      for (const p of Object.values(state.players as Record<string, Json>)) {
        if (p.nfl_team === team && n < 40) {
          p.name = `${String(p.name).split(" ")[0]} ${LONG_SURNAME}`;
          n++;
        }
      }
    },
  },
  "partial-reveal": {
    id: "partial-reveal",
    describe: "preseason fully revealed and regular-season weeks revealed only up to week 4 for the viewing GM; later weeks stay in state.games",
    apply(state, { gmId }) {
      state.reveal ??= { preseasonWeek: {}, regularWeek: {}, playoffRounds: {}, step: {} };
      state.reveal.preseasonWeek[gmId] = 3;
      state.reveal.regularWeek[gmId] = PARTIAL_REVEAL_WEEK;
    },
  },
};

export const PARTIAL_REVEAL_WEEK = 4;

/** Returns a new save string with the variant applied. The input string is never mutated. */
export function applyVariant(save: string, id: VariantId): string {
  const doc = JSON.parse(save) as { version: number; state: Json };
  const s = doc.state;
  const gm = (s.gms as Json[]).find((g) => g.id === s.viewerGmId);
  VARIANTS[id].apply(s, { gmId: s.viewerGmId as string, team: (gm?.teamCode as string) ?? "" });
  return JSON.stringify(doc);
}

export interface SecretScores {
  /** Score strings ("27-24" and "24-27") of games the GM has NOT revealed and that no revealed game shares. */
  secret: string[];
  /** Weeks that must not appear scored anywhere. */
  hiddenWeeks: number[];
  revealedWeek: number;
}

/**
 * What a spoiler probe looks for: the final scores of regular-season games beyond the GM's revealed week. Scores that a
 * revealed game also has are excluded, because they could legitimately be on screen.
 */
export function secretScores(save: string, revealedWeek: number): SecretScores {
  const s = (JSON.parse(save) as { state: Json }).state;
  const games = (s.games as Json[]).filter((g) => g.played && g.phase === "REG");
  const seen = new Set<string>();
  for (const g of games.filter((g) => g.week <= revealedWeek)) {
    seen.add(`${g.homeScore}-${g.awayScore}`);
    seen.add(`${g.awayScore}-${g.homeScore}`);
  }
  const secret = new Set<string>();
  const hiddenWeeks = new Set<number>();
  for (const g of games.filter((g) => g.week > revealedWeek)) {
    hiddenWeeks.add(g.week);
    // a pair whose larger side is under 10 reads as a win-loss record ("3-4"), which the page legitimately shows; the
    // probe cannot tell them apart, so it leaves them out rather than raise a false alarm (a documented blind spot)
    if (Math.max(g.homeScore, g.awayScore) < 10) continue;
    for (const k of [`${g.homeScore}-${g.awayScore}`, `${g.awayScore}-${g.homeScore}`]) if (!seen.has(k)) secret.add(k);
  }
  return { secret: [...secret], hiddenWeeks: [...hiddenWeeks].sort((a, b) => a - b), revealedWeek };
}

/** Scores like "27–24", "27-24" or "27 - 24" found in visible text that match a secret pair. */
export function leakedScores(pageText: string, secret: readonly string[]): string[] {
  const hits: string[] = [];
  const re = /\b(\d{1,2})\s*[–—-]\s*(\d{1,2})\b/g;
  const set = new Set(secret);
  for (let m = re.exec(pageText); m; m = re.exec(pageText)) {
    if (set.has(`${m[1]}-${m[2]}`)) hits.push(m[0]);
  }
  return [...new Set(hits)];
}
