import { useEffect, useState } from "react";

import { teamFullName } from "@/data/teams";
import { downloadBackup, peekKeptDynasty, type KeptDynasty } from "@/state/saveBackup";
import { keepCurrentDynasty, useStore, worthKeeping } from "@/state/store";

import { useDialog } from "./useDialog.ts";

/**
 * The confirmation for "New solo dynasty". It says what is about to be replaced, what is kept (a recovery copy in
 * this browser, which a new dynasty's autosaves cannot touch), what that copy does not protect, and how to get it
 * back. The copy is made and verified *before* the reset; if it cannot be made the reset does not go ahead unless
 * the player says so.
 */
export function NewDynastyConfirm({ onCancel, onStart }: { onCancel: () => void; onStart: () => void }) {
  const dialogRef = useDialog(onCancel);
  const team = useStore((s) => s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? "");
  const season = useStore((s) => s.season);
  const seasons = useStore((s) => s.history.length);
  const keep = useStore((s) => worthKeeping(s));
  const [older, setOlder] = useState<KeptDynasty | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void peekKeptDynasty().then((k) => live && setOlder(k));
    return () => {
      live = false;
    };
  }, []);

  const start = async (force = false) => {
    setBusy(true);
    const r = await keepCurrentDynasty();
    setBusy(false);
    if (r === "failed" && !force) {
      setFailed(true);
      return;
    }
    onStart();
  };

  return (
    <div className="modal-scrim" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal-card"
        style={{ maxWidth: 520 }}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="new-dynasty-title"
        aria-describedby="new-dynasty-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="new-dynasty-title" className="modal-title">Start a brand-new solo dynasty?</h2>
        </div>
        <div id="new-dynasty-body" style={{ display: "grid", gap: 10, fontSize: 13.5, lineHeight: 1.45 }}>
          {keep ? (
            <p style={{ margin: 0 }}>
              This replaces your current dynasty{team ? <> — <strong>{teamFullName(team)}</strong></> : null}, {seasons} season{seasons === 1 ? "" : "s"} played,
              now in {season}. It is not deleted: a recovery copy is kept in this browser and
              <strong> Restore previous dynasty</strong> brings it back.
            </p>
          ) : (
            <p style={{ margin: 0 }}>Your current league has not started yet, so there is nothing to lose.</p>
          )}
          {keep && older && (
            <p style={{ margin: 0 }} role="note">
              <strong>This will replace the recovery copy already kept</strong> ({older.team ? `${teamFullName(older.team)}, ` : ""}{older.seasonsPlayed} season{older.seasonsPlayed === 1 ? "" : "s"}, {older.season}).
              That earlier dynasty would be gone for good. Download a backup if you want to keep it.
            </p>
          )}
          {keep && (
            <p style={{ margin: 0, color: "var(--ink-dim)" }}>
              The recovery copy lives only in this browser&rsquo;s storage and covers one dynasty. Clearing site data removes it. For a
              copy that survives that, download a backup.
            </p>
          )}
          {failed && (
            <p role="alert" className="notice bad" style={{ margin: 0 }}>
              A recovery copy couldn&rsquo;t be made in this browser, so nothing is protected. Download a backup first, or start
              anyway and accept that the current dynasty will be lost.
            </p>
          )}
          {note && <p role="status" style={{ margin: 0 }}>{note}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={onCancel}>Cancel</button>
            {keep && (
              <button type="button" onClick={() => setNote(`Backup downloaded (${(downloadBackup() / 1024 / 1024).toFixed(1)} MB).`)}>
                Download backup first
              </button>
            )}
            {failed ? (
              <button type="button" className="gd-cut" disabled={busy} onClick={() => void start(true)}>Start anyway — lose current dynasty</button>
            ) : (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void start()}>
                {busy ? "Keeping a copy…" : "Start new dynasty"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
