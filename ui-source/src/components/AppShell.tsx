import { NavLink } from "react-router-dom";

import { STAGE_HOME, STAGE_LABEL } from "@/state/stageMachine";
import { useStore, isInSeason } from "@/state/store";
import { teamFullName } from "@/data/teams";

import "./app-shell.css";
import { useTeamTheme } from "./useTeamTheme.ts";

interface NavItem {
  to: string;
  label: string;
  group?: string;
}

const IN_SEASON_NAV: NavItem[] = [
  { to: "/hub", label: "Weekly Team Hub" },
  { to: "/bracket", label: "Playoff Bracket" },
  { to: "/roster", label: "Roster & Cap", group: "Front office" },
  { to: "/league-rosters", label: "League Rosters" },
  { to: "/coaching", label: "Coaching Staff" },
  { to: "/trade", label: "Trade Proposal" },
  { to: "/free-agency", label: "Free Agency" },
  { to: "/schedule", label: "Full Schedule", group: "League" },
  { to: "/league-stats", label: "League Stats" },
  { to: "/player-stats", label: "Player Statistics" },
  { to: "/history", label: "League History" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  useTeamTheme();
  const stage = useStore((s) => s.stage);
  const season = useStore((s) => s.season);
  const week = useStore((s) => s.week);
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const newLeague = useStore((s) => s.newLeague);

  const teamCode = gms.find((g) => g.id === viewerGmId)?.teamCode;
  const seasonScreens = isInSeason(stage);

  return (
    <div className="app">
      <nav className="rail">
        <div className="brand">
          <span className="mark">FS</span>
          <div>
            <b>FRANCHISE SIM</b>
            <span>{teamCode ? teamFullName(teamCode) : "No team yet"}</span>
          </div>
        </div>
        <div className="stagechip">
          {STAGE_LABEL[stage]} · {season}
          {week ? ` · Wk ${week}` : ""}
        </div>

        <NavLink to="/setup" className={({ isActive }) => (isActive ? "active" : "")}>
          League Setup
        </NavLink>

        {seasonScreens &&
          renderGroupedNav(IN_SEASON_NAV)}

        {!seasonScreens && (
          <>
            <div className="railgroup">Current stage</div>
            <NavLink
              to={STAGE_HOME[stage]}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {STAGE_LABEL[stage]}
            </NavLink>
            <div className="railgroup">Reference</div>
            <NavLink to="/history" className={({ isActive }) => (isActive ? "active" : "")}>
              League History
            </NavLink>
            <NavLink to="/gallery" className={({ isActive }) => (isActive ? "active" : "")}>
              Screen Gallery
            </NavLink>
          </>
        )}

        <div className="spacer" />
        <NavLink to="/gallery" className={({ isActive }) => (isActive ? "active" : "")}>
          Screen Gallery
        </NavLink>
        <button
          className="reset"
          onClick={() => {
            if (confirm("Start a brand-new league? This clears the current save.")) newLeague();
          }}
        >
          New league
        </button>
      </nav>
      <main className="app-main">{children}</main>
    </div>
  );
}

function renderGroupedNav(items: NavItem[]) {
  const out: React.ReactNode[] = [];
  let lastGroup: string | undefined;
  for (const item of items) {
    if (item.group && item.group !== lastGroup) {
      out.push(
        <div className="railgroup" key={`g-${item.group}`}>
          {item.group}
        </div>,
      );
      lastGroup = item.group;
    }
    out.push(
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) => (isActive ? "active" : "")}
      >
        {item.label}
      </NavLink>,
    );
  }
  return out;
}
