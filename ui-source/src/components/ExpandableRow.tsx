import { m, type Variants } from "framer-motion";
import { type ReactNode, useRef, useState } from "react";

import { useRowRises } from "@/motion/Stagger";
import { EASE, useMotion } from "@/motion/tokens";

/**
 * The chevron-expand row the mockups use for players / prospects / coaches:
 * a grid `.prow` that toggles a `.pdetail` panel; chevron rotates 90° on open.
 */
export function ExpandableRow({
  columns,
  gridTemplate,
  detail,
  dimmed = false,
  onRowClick,
  open: openProp,
  onOpenChange,
}: {
  columns: ReactNode;
  gridTemplate: string;
  detail?: ReactNode;
  dimmed?: boolean;
  onRowClick?: () => void;
  /** Controlled open state — e.g. forced open by an action elsewhere on the
   *  row (Free Agency's "Negotiate" button opens straight to the offer
   *  panel). Omit to let the row manage its own chevron toggle. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const motion = useMotion();
  const detailRef = useRef<HTMLDivElement>(null);
  const rises = useRowRises();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean | ((o: boolean) => boolean)): void => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (onOpenChange) onOpenChange(resolved);
    else setUncontrolledOpen(resolved);
  };
  // Inside a <StaggerList> the row rises in with its siblings; outside one,
  // `variants` has no parent driving it and the row is just a row.
  const rise: Variants = {
    hidden: { opacity: 0, y: motion.full ? 10 : 4 },
    show: { opacity: 1, y: 0, transition: { duration: motion.dur, ease: EASE } },
  };
  return (
    <m.div className={`prow-wrap${dimmed ? " dimmed" : ""}`} variants={motion.off || !rises ? undefined : rise}>
      <div
        className="prow"
        style={{ gridTemplateColumns: gridTemplate }}
        role={detail || onRowClick ? "button" : undefined}
        tabIndex={detail || onRowClick ? 0 : undefined}
        aria-expanded={detail ? open : undefined}
        onClick={() => {
          if (detail) setOpen((o) => !o);
          onRowClick?.();
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (detail) setOpen((o) => !o);
            onRowClick?.();
          }
        }}
      >
        {columns}
        {detail ? <span className={`chev${open ? " open" : ""}`}>▸</span> : <span />}
      </div>
      {detail && open && (
        // opens by growing rather than appearing
        <m.div
          className="pdetail"
          style={{ display: "block", overflow: "hidden" }}
          ref={detailRef}
          // clip only while it grows; afterwards tooltips and focus rings must show
          onAnimationComplete={() => {
            if (detailRef.current) detailRef.current.style.overflow = "visible";
          }}
          initial={motion.off ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: motion.full ? 0.28 : 0.14, ease: EASE }}
        >
          {detail}
        </m.div>
      )}
    </m.div>
  );
}

export function RatingBar({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rb">
      <span className="rb__label">{label}</span>
      <div className="rb__track">
        <div className="rb__fill" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="rb__value oswald">
        {value}
        {suffix}
      </span>
    </div>
  );
}
