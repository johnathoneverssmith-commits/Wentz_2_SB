import { useRef, useState } from "react";

import { downloadBackup, peekBackup, restoreFromText } from "@/state/saveBackup";

/**
 * Back a dynasty up to a file, and bring one back.
 *
 * A single-player league lives in one browser's storage and nowhere else: a
 * cleared cache, a new computer or a full quota and it was gone. This writes
 * the whole league to a file the player keeps, and reads one back — through
 * the same migration a stored save goes through, so an old backup still
 * loads after the game has moved on. A restore is only reported as done once
 * the restored league has reached storage.
 */
export function SaveBackup({ inline = false }: { inline?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const download = () => {
    const bytes = downloadBackup();
    setNote(`Backup downloaded (${(bytes / 1024 / 1024).toFixed(1)} MB).`);
  };

  const restore = async (file: File) => {
    const text = await file.text().catch(() => null);
    if (text == null) return setNote("That file couldn't be read.");
    const peek = peekBackup(text);
    if (!peek) return setNote(text.trimStart().startsWith("{") ? "That file isn't a dynasty backup." : "That file couldn't be read.");
    if (!confirm(`Replace the current dynasty with the ${peek.season ?? ""} backup from this file?`)) return;
    const r = await restoreFromText(text);
    if (!r.ok) return setNote(r.reason === "notABackup" ? "That file isn't a dynasty backup." : "That file couldn't be read.");
    setNote(
      r.saved
        ? `Restored the ${r.season} dynasty and saved it.`
        : `Restored the ${r.season} dynasty, but it could not be saved to this browser. Keep this tab open and download a fresh backup.`,
    );
  };

  return (
    <div style={{ display: "grid", gap: 4, margin: inline ? 0 : "4px 0", ...(inline ? { gridAutoFlow: "column", justifyContent: "start", alignItems: "center" } : null) }}>
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
      {note && <span role="status" style={{ fontSize: 10.5, color: "var(--ink-faint)", padding: "0 10px" }}>{note}</span>}
    </div>
  );
}
