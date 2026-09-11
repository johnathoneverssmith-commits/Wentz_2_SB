import { type ReactNode, useState } from "react";

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
}: {
  columns: ReactNode;
  gridTemplate: string;
  detail?: ReactNode;
  dimmed?: boolean;
  onRowClick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`prow-wrap${dimmed ? " dimmed" : ""}`}>
      <div
        className="prow"
        style={{ gridTemplateColumns: gridTemplate }}
        onClick={() => {
          if (detail) setOpen((o) => !o);
          onRowClick?.();
        }}
      >
        {columns}
        {detail ? <span className={`chev${open ? " open" : ""}`}>▸</span> : <span />}
      </div>
      {detail && open && <div className="pdetail" style={{ display: "block" }}>{detail}</div>}
    </div>
  );
}

export function RatingBar({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
      <span style={{ width: 130, fontSize: 12.5, color: "var(--ink-dim)", flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: "var(--panel-raised)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", background: "var(--team)", borderRadius: 3, width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="oswald" style={{ width: 30, textAlign: "right", fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>
        {value}
        {suffix}
      </span>
    </div>
  );
}
