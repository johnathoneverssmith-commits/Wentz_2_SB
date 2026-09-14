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

/**
 * These were a row of plain buttons and a div: nothing said "tab", nothing
 * tied a tab to the panel it opens, and arrow keys did nothing — a screen
 * reader announced eight unrelated buttons and a keyboard user tabbed through
 * every one of them to reach the content. The pattern is standard, so it may
 * as well be the standard one.
 *
 * `group` namespaces the generated ids so two tab sets on one screen don't
 * collide; the default is fine when there's only one.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  group = "tabs",
  label,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  group?: string;
  /** What this set of tabs is for, when the surrounding card doesn't say. */
  label?: string;
}) {
  const open = tabs.filter((t) => !t.locked);
  const step = (by: number): void => {
    const i = open.findIndex((t) => t.id === active);
    const next = open[(i + by + open.length) % open.length];
    if (next) onChange(next.id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label ?? "Sections"}>
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={`${group}-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${group}-panel-${t.id}`}
            aria-disabled={t.locked || undefined}
            // only the selected tab is in the tab order; arrows move between
            tabIndex={selected ? 0 : -1}
            className={`tab${selected ? " active" : ""}${t.locked ? " locked" : ""}`}
            onClick={() => !t.locked && onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                step(1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                step(-1);
              } else if (e.key === "Home") {
                e.preventDefault();
                if (open[0]) onChange(open[0].id);
              } else if (e.key === "End") {
                e.preventDefault();
                const last = open[open.length - 1];
                if (last) onChange(last.id);
              }
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function Panel({
  open,
  children,
  id,
  group = "tabs",
}: {
  open: boolean;
  children: ReactNode;
  /** the tab id this panel belongs to, so the two can point at each other */
  id?: string;
  group?: string;
}) {
  return (
    <div
      className={`panel${open ? " open" : ""}`}
      {...(id
        ? {
            id: `${group}-panel-${id}`,
            role: "tabpanel",
            "aria-labelledby": `${group}-tab-${id}`,
            hidden: !open,
          }
        : {})}
    >
      {children}
    </div>
  );
}

/** Small hook for the common "one active tab" pattern. */
export function useTabs(initial: string) {
  const [active, setActive] = useState(initial);
  return { active, setActive };
}

export function Footer({ children, bordered = true }: { children: ReactNode; bordered?: boolean }) {
  return <div className={`footer${bordered ? "" : " no-border"}`}>{children}</div>;
}
