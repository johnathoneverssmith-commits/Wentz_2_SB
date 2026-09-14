import type { ReactNode } from "react";

import { pressable } from "./bits.tsx";
import { useDialog } from "./useDialog.ts";

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
  const dialogRef = useDialog(onDismiss);
  return (
    <div
      ref={dialogRef}
      className="fs-overlay"
      {...pressable(onDismiss)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="fs-overlay-title"
    >
      <div>
        {kicker && <p className="fs-kicker">{kicker}</p>}
        <p className="fs-big" id="fs-overlay-title">
          {big}
        </p>
        {note && <p className="fs-note">{note}</p>}
      </div>
    </div>
  );
}
