import type { LeagueState } from "@/domain";

import { CURRENT_SAVE_VERSION, migrateLeagueSave } from "./saveMigration";
import { flushSave, keepCurrentDynasty, readKeptDynasty, useStore } from "./store";

export const BACKUP_FORMAT = "nfl-franchise-sim-save";

/** The whole league as the backup file's JSON text. */
export function backupJson(): { text: string; file: string } {
  const st = useStore.getState() as unknown as Record<string, unknown>;
  const league: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(st)) if (typeof v !== "function") league[k] = v;
  const team = (league.gms as LeagueState["gms"] | undefined)?.find((g) => g.id === league.viewerGmId)?.teamCode ?? "league";
  return {
    text: JSON.stringify({ format: BACKUP_FORMAT, version: CURRENT_SAVE_VERSION, league }),
    file: `dynasty-${team}-${String(league.season ?? "")}.json`,
  };
}

/** Hand the backup to the browser as a download. Returns its size in bytes. */
export function downloadBackup(): number {
  const { text, file } = backupJson();
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob.size;
}

export type RestoreOutcome =
  | { ok: true; season: number; saved: boolean }
  | { ok: false; reason: "notABackup" | "unreadable" };

/**
 * Parse a backup, migrate it and make it the current dynasty. `saved` says whether the restored
 * league then reached durable storage — a restore that can't be saved must not read as a success.
 */
export async function restoreFromText(text: string): Promise<RestoreOutcome> {
  try {
    const parsed = JSON.parse(text) as { format?: string; version?: number; league?: unknown };
    const league = parsed.league as LeagueState | undefined;
    if (parsed.format !== BACKUP_FORMAT || !league?.teams || !league.players || !league.gms) {
      return { ok: false, reason: "notABackup" };
    }
    const migrated = migrateLeagueSave(league, parsed.version ?? 0);
    useStore.setState(migrated as never);
    const saved = await flushSave();
    return { ok: true, season: migrated.season, saved };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/** Peek at the season in a backup without applying it (for the confirm prompt). */
export function peekBackup(text: string): { season?: number } | null {
  try {
    const p = JSON.parse(text) as { format?: string; league?: { season?: number } };
    return p.format === BACKUP_FORMAT ? { season: p.league?.season } : null;
  } catch {
    return null;
  }
}

/** What the kept (previous) dynasty is, for the "Restore previous dynasty" control. Null when none is kept. */
export interface KeptDynasty {
  season: number;
  stage: string;
  team: string;
  seasonsPlayed: number;
  savedAt?: number;
}
export async function peekKeptDynasty(): Promise<KeptDynasty | null> {
  const kept = await readKeptDynasty();
  if (!kept) return null;
  try {
    const st = (JSON.parse(kept.json) as { state?: Partial<LeagueState> }).state;
    if (!st?.teams || !st.gms) return null;
    const team = st.gms.find((g) => g.id === st.viewerGmId)?.teamCode ?? "";
    return { season: st.season ?? 0, stage: String(st.stage ?? ""), team, seasonsPlayed: st.history?.length ?? 0, ...(kept.savedAt ? { savedAt: kept.savedAt } : {}) };
  } catch {
    return null;
  }
}

/**
 * Bring the kept dynasty back. The dynasty on screen is kept in its place first, so restoring is itself undoable
 * (a second press swaps back). `saved` says whether the restored league then reached storage.
 */
export async function restoreKeptDynasty(): Promise<RestoreOutcome> {
  const kept = await readKeptDynasty();
  if (!kept) return { ok: false, reason: "notABackup" };
  try {
    const env = JSON.parse(kept.json) as { state?: LeagueState; version?: number };
    if (!env.state?.teams || !env.state.players || !env.state.gms) return { ok: false, reason: "notABackup" };
    const migrated = migrateLeagueSave(env.state, env.version ?? 0);
    await keepCurrentDynasty(); // whatever is on screen takes the kept slot (we hold the other one in memory)
    useStore.setState(migrated as never);
    const saved = await flushSave();
    return { ok: true, season: migrated.season, saved };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
