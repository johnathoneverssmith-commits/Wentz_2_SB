import { useRef, useState } from "react";

import type { LeagueState } from "@/domain";
import { CURRENT_SAVE_VERSION, migrateLeagueSave } from "@/state/saveMigration";
import { useStore } from "@/state/store";

const FORMAT = "nfl-franchise-sim-save";

/**
 * Back a dynasty up to a file, and bring one back.
 *
 * A single-player league lives in one browser's storage and nowhere else: a
 * cleared cache, a new computer or a full quota and it was gone. This writes
 * the whole league to a file the player keeps, and reads one back — through
 * the same migration a stored save goes through, so an old backup still
 * loads after the game has moved on.
 */
export function SaveBackup() {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const download = () => {
    const st = useStore.getState() as unknown as Record<string, unknown>;
    const league: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(st)) if (typeof v !== "function") league[k] = v;
    const blob = new Blob([JSON.stringify({ format: FORMAT, version: CURRENT_SAVE_VERSION, league })], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const team = (league.gms as LeagueState["gms"] | undefined)?.find((g) => g.id === league.viewerGmId)?.teamCode ?? "league";
    a.href = url;
    a.download = `dynasty-${team}-${String(league.season ?? "")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNote("Backup downloaded.");
  };

  const restore = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as { format?: string; version?: number; league?: unknown };
      const league = parsed.league as LeagueState | undefined;
      if (parsed.format !== FORMAT || !league?.teams || !league.players || !league.gms) {
        setNote("That file isn't a dynasty backup.");
        return;
      }
      if (!confirm(`Replace the current dynasty with the ${league.season} backup from this file?`)) return;
      const migrated = migrateLeagueSave(league, parsed.version ?? 0);
      useStore.setState(migrated as never);
      setNote(`Restored the ${migrated.season} dynasty.`);
    } catch {
      setNote("That file couldn't be read.");
    }
  };

  return (
    <div style={{ display: "grid", gap: 4, margin: "4px 0" }}>
      <button type="button" className="reset" onClick={download} title="Save this dynasty to a file you keep">
        Download backup
      </button>
      <button type="button" className="reset" onClick={() => input.current?.click()} title="Load a dynasty from a backup file">
        Restore from backup
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void restore(f);
          e.target.value = "";
        }}
      />
      {note && <span style={{ fontSize: 10.5, color: "var(--ink-faint)", padding: "0 10px" }}>{note}</span>}
    </div>
  );
}
