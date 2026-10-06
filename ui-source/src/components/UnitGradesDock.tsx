import { useState } from "react";
import { useLocation } from "react-router-dom";

import { UnitGrades } from "@/components/UnitGrades";
import { useDialog } from "@/components/useDialog";

/**
 * Screens where a GM is building the roster and wants to know what it needs:
 * both drafts, both free-agency markets, trade proposals and the deadline.
 */
const SCREENS = new Set([
  "/draft",
  "/free-agency",
  "/free-agency-board",
  "/trade",
  "/trade-deadline",
  "/coaching-draft",
]);

/**
 * Unit Grades, one press away from where the decision is made.
 *
 * It opens over the screen rather than navigating to it, so a half-built
 * trade, a draft board's filters and selection, a free-agent offer and a
 * deadline turn are all exactly where they were when it closes.
 */
export function UnitGradesDock({ teamCode }: { teamCode: string | null | undefined }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  if (!teamCode || !SCREENS.has(pathname)) return null;
  return (
    <>
      <button
        type="button"
        className="unitgrades-dock"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        Unit Grades
      </button>
      {open && <Drawer teamCode={teamCode} onClose={() => setOpen(false)} />}
    </>
  );
}

function Drawer({ teamCode, onClose }: { teamCode: string; onClose: () => void }) {
  const ref = useDialog(onClose);
  return (
    <div className="unitgrades-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="unitgrades-drawer" role="dialog" aria-modal="true" aria-label="Unit grades" ref={ref}>
        <div className="unitgrades-head">
          <strong>Your unit grades</strong>
          <button type="button" onClick={onClose} aria-label="Close unit grades">
            Close
          </button>
        </div>
        <div className="unitgrades-body">
          <UnitGrades teamCode={teamCode} />
        </div>
      </div>
    </div>
  );
}
