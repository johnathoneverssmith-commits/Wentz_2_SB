import type { ReactNode } from "react";

/** Card-covering overlay — the draft "on the clock" and FA "Day N" interstitials. */
export function FullScreenOverlay({
  kicker,
  big,
  note,
  onDismiss,
}: {
  kicker?: string;
  big: ReactNode;
  note?: string;
  onDismiss: () => void;
}) {
  return (
    <div className="fs-overlay" onClick={onDismiss}>
      <div>
        {kicker && <p className="fs-kicker">{kicker}</p>}
        <p className="fs-big">{big}</p>
        {note && <p className="fs-note">{note}</p>}
      </div>
    </div>
  );
}
