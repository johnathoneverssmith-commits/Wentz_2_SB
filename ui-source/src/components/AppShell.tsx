import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { STAGE_HOME, STAGE_LABEL } from "@/state/stageMachine";
import { useOnlineSync } from "@/state/useLeagueActions";
import { useGameAudio } from "@/audio/useGameAudio";

import { SoundControl } from "./SoundControl.tsx";
import { isOnline } from "@/state/online";
import { isInSeason, onSaveStateChange, useStore } from "@/state/store";
import { teamFullName } from "@/data/teams";

import "./app-shell.css";
import { useTeamTheme } from "./useTeamTheme.ts";

/** The viewer's team, for the counts the rail badges show. */
function teamCodeOf(s: { gms: { id: string; teamCode: string }[]; viewerGmId: string }): string {
  return s.gms.find((g) => g.id === s.viewerGmId)?.teamCode ?? "";
}

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

/**
 * Reference screens that are safe to browse from any offseason stage.
 *
 * Trade Proposal was missing, which is backwards: the offseason is when
 * trades happen, and it's when the league sends offers. A GM could be sitting
 * on two of them with no way to reach the screen from the rail.
 */
const OFFSEASON_REFERENCE_NAV: NavItem[] = [
  { to: "/roster", label: "Roster & Cap" },
  { to: "/league-rosters", label: "League Rosters" },
  { to: "/trade", label: "Trade Proposal" },
  { to: "/coaching", label: "Coaching Staff" },
  { to: "/history", label: "League History" },
];

const active = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

/**
 * Take everyone to Game Day when a week is actually played.
 *
 * Single-player the action that simulates the week also routes to the screen
 * that shows it. Online the week is played by the server, so the result
 * arrives as a state change with nothing to carry anyone there — GMs got new
 * standings and never saw a game, which is the whole point of playing one.
 *
 * Driven by the league's own `pendingGameDay` rather than by whoever clicked,
 * so the GM who readied last and the three who were already waiting all land
 * on the same screen. It fires on the change, not on the value, so reloading
 * or navigating away afterwards doesn't drag you back.
 */
function useGameDayArrival(): void {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const pending = useStore((s) => s.pendingGameDay);
  const key = pending ? `${pending.phase}-${pending.week}-${pending.gameIds.length}` : null;
  const seen = useRef<string | null>(key);
  useEffect(() => {
    if (!isOnline()) {
      seen.current = key;
      return;
    }
    if (key && key !== seen.current && pathname !== "/game-day") {
      seen.current = key;
      nav("/game-day");
      return;
    }
    seen.current = key;
  }, [key, nav, pathname]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  useTeamTheme();
  useGameDayArrival();
  // in an online league, take the server's copy whenever it says the league
  // moved; inert (and it costs nothing) in a single-player game
  useOnlineSync();
  // the score follows where you are; the cues follow what happens to you.
  // Silent until the player turns it on — see `SoundControl`.
  useGameAudio();
  // losing a dynasty to a silent storage failure is the worst bug this app
  // could have, so it is the one thing the shell always says out loud
  const [saveBroken, setSaveBroken] = useState(false);
  useEffect(() => onSaveStateChange(setSaveBroken), []);
  // things waiting on the GM, so an offer doesn't sit unseen on a screen
  // they had no reason to open
  const offers = useStore((s) =>
    s.trades.filter((t) => t.status === "offered" && t.toTeam === teamCodeOf(s)).length,
  );
  const navBadges = { "/trade": offers };
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

        {!inSetup && seasonScreens && renderGroupedNav(IN_SEASON_NAV, navBadges)}

        {!inSetup && !seasonScreens && (
          <>
            <div className="railgroup">Current stage</div>
            <NavLink to={STAGE_HOME[stage]} className={active}>
              {STAGE_LABEL[stage]}
            </NavLink>
            <div className="railgroup">Reference</div>
            {renderGroupedNav(OFFSEASON_REFERENCE_NAV, navBadges)}
          </>
        )}

        <div className="spacer" />
        <SoundControl />
        {!inSetup && (
          <NavLink to="/setup" className={active}>
            League settings
          </NavLink>
        )}
        <NavLink to="/online" className={active}>
          Online leagues
        </NavLink>
        {import.meta.env.DEV && (
          <NavLink to="/gallery" className={active}>
            Screen Gallery
          </NavLink>
        )}
        <button
          className="reset"
          onClick={() => {
            if (confirm("Start a brand-new solo dynasty? This clears the current save.")) newLeague();
          }}
          title="Solo play on this device. For a league real people can join, use Online leagues above."
        >
          New solo dynasty
        </button>
      </nav>
      <main className="app-main">
        {saveBroken && (
          <div className="notice bad" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
            <strong>This dynasty isn't being saved.</strong> The browser refused to write to
            storage — usually a full quota, or a private window, which blocks it entirely. Play
            continues, but closing this tab will lose everything since the last successful save.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/** Count of things waiting on the GM at a route, shown as a rail badge. */
function renderGroupedNav(items: NavItem[], badges: Record<string, number> = {}) {
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
    const badge = badges[item.to] ?? 0;
    out.push(
      <NavLink key={item.to} to={item.to} className={active}>
        {item.label}
        {badge > 0 && (
          <span className="railbadge" aria-label={`${badge} waiting`}>
            {badge}
          </span>
        )}
      </NavLink>,
    );
  }
  return out;
}
