/**
 * The structural primitives every mockup shares: the centered card, its gradient
 * header with a team badge, the stat ticker, underline tabs, and tab panels.
 * Class names match the mockups so screen markup ports 1:1.
 */
import { type ReactNode, useState } from "react";

export function Card({
  children,
  maxWidth = 820,
  twoTeam = false,
}: {
  children: ReactNode;
  maxWidth?: number;
  twoTeam?: boolean;
}) {
  return (
    <div className="app-card-wrap">
      <div className={`card${twoTeam ? " two-team" : ""}`} style={{ maxWidth }}>
        {children}
      </div>
    </div>
  );
}

export function CardHeader({
  badge,
  title,
  subtitle,
  right,
  action,
  twoTeam = false,
}: {
  badge: ReactNode;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  action?: ReactNode;
  twoTeam?: boolean;
}) {
  return (
    <div className={`header${twoTeam ? " two-team" : ""}`}>
      <div className="header-left">
        <div className="badge">{badge}</div>
        <div>
          <h1>{title}</h1>
          {subtitle != null && <p>{subtitle}</p>}
        </div>
      </div>
      {right != null && <div className="right">{right}</div>}
      {action}
    </div>
  );
}

export interface TickerStat {
  label: string;
  value: ReactNode;
  className?: string;
}

export function Ticker({ stats }: { stats: TickerStat[] }) {
  return (
    <div className="ticker">
      {stats.map((s, i) => (
        <div className="stat" key={i}>
          <p className="stat-label">{s.label}</p>
          <p className={`stat-value${s.className ? ` ${s.className}` : ""}`}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

export interface TabDef {
  id: string;
  label: ReactNode;
  locked?: boolean;
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab${t.id === active ? " active" : ""}${t.locked ? " locked" : ""}`}
          onClick={() => !t.locked && onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Panel({ open, children }: { open: boolean; children: ReactNode }) {
  return <div className={`panel${open ? " open" : ""}`}>{children}</div>;
}

/** Small hook for the common "one active tab" pattern. */
export function useTabs(initial: string) {
  const [active, setActive] = useState(initial);
  return { active, setActive };
}

export function Footer({ children, bordered = true }: { children: ReactNode; bordered?: boolean }) {
  return <div className={`footer${bordered ? "" : " no-border"}`}>{children}</div>;
}
