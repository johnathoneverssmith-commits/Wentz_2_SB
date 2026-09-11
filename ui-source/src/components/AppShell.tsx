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

/** Reference screens that are safe to browse from any offseason stage. */
const OFFSEASON_REFERENCE_NAV: NavItem[] = [
  { to: "/roster", label: "Roster & Cap" },
  { to: "/league-rosters", label: "League Rosters" },
  { to: "/coaching", label: "Coaching Staff" },
  { to: "/history", label: "League History" },
];

const active = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

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
  const inSetup = stage === "setup";

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
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

        {inSetup && (
          <>
            <NavLink to="/setup" className={active}>
              League Setup
            </NavLink>
            <p className="railnote">Pick your team and league rules, then mark ready to begin.</p>
          </>
        )}

        {!inSetup && seasonScreens && renderGroupedNav(IN_SEASON_NAV)}

        {!inSetup && !seasonScreens && (
          <>
            <div className="railgroup">Current stage</div>
            <NavLink to={STAGE_HOME[stage]} className={active}>
              {STAGE_LABEL[stage]}
            </NavLink>
            <div className="railgroup">Reference</div>
            {OFFSEASON_REFERENCE_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={active}>
                {item.label}
              </NavLink>
            ))}
          </>
        )}

        <div className="spacer" />
        {!inSetup && (
          <NavLink to="/setup" className={active}>
            League settings
          </NavLink>
        )}
        {import.meta.env.DEV && (
          <NavLink to="/gallery" className={active}>
            Screen Gallery
          </NavLink>
        )}
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
      <NavLink key={item.to} to={item.to} className={active}>
        {item.label}
      </NavLink>,
    );
  }
  return out;
}
