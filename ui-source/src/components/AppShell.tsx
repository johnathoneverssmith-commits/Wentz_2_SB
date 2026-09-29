import { useEffect, useRef, useState } from "react";
import { goLocal, onlineSession } from "@/state/online";
import { SaveBackup } from "./SaveBackup";
import { LeagueWire } from "./LeagueWire";
import { TurnClock } from "./TurnClock";
import { TurnAlerts } from "./TurnAlerts";
import { displaySeasonFor } from "@/state/stageMachine";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { currentScreen } from "@/state/stageMachine";
import { stepOf } from "@/state/reveal";
import { useOnlineSync } from "@/state/useLeagueActions";
import { useGameAudio } from "@/audio/useGameAudio";

import { SoundControl } from "./SoundControl.tsx";
import { isOnline } from "@/state/online";
import { isInSeason, onSaveCorrupted, onSaveStateChange, useStore } from "@/state/store";
import { teamFullName } from "@/data/teams";
import { viewerWeek } from "@/state/reveal";
import { onTheClock as faOnTheClock } from "@/state/freeAgencyEvent";
import { coachingOnTheClock } from "@/state/coachingDraft";
import { onTheClock as deadlineOnTheClock, pendingFor } from "@/state/tradeDeadline";

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
  // Signing is asynchronous now — there is no free-agency stage to visit, so
  // the market has to be reachable from wherever you happen to be.
  { to: "/free-agency", label: "Free Agency" },
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
  // a save that failed to *read back* is a different failure from one that
  // failed to write — the player is looking at a fresh league right now and
  // needs to know that isn't the dynasty they left, not just that saving is
  // currently broken
  const [saveCorrupted, setSaveCorrupted] = useState(false);
  useEffect(() => onSaveCorrupted(setSaveCorrupted), []);
  // things waiting on the GM, so an offer doesn't sit unseen on a screen
  // they had no reason to open
  const offers = useStore((s) =>
    s.trades.filter((t) => t.status === "offered" && t.toTeam === teamCodeOf(s)).length,
  );
  const navBadges = { "/trade": offers };
  const stage = useStore((s) => s.stage);
  const season = useStore((s) => s.season);
  const week = useStore(viewerWeek);
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const newLeague = useStore((s) => s.newLeague);
  const navTo = useNavigate();

  const teamCode = gms.find((g) => g.id === viewerGmId)?.teamCode;
  // your turn in a turn-based event, flagged on the rail: a turn left too
  // long is one your staff takes for you
  const yourTurn = useStore((s) => {
    const me = teamCodeOf(s);
    if (!me) return false;
    if ((s.stage === "fantasyDraft" || s.stage === "offseasonDraft") && s.draft) {
      return s.draft.pickOrder[s.draft.currentPickIndex] === me;
    }
    if (s.stage === "freeAgency" || s.stage === "midseasonFreeAgency") return faOnTheClock(s) === me;
    if (s.stage === "coachingDraft") return coachingOnTheClock(s) === me;
    if (s.stage === "tradeDeadline") return pendingFor(s, me) != null;
    return false;
  });
  // who the clock is running for, when it isn't you
  const clockTeam = useStore((s) => {
    if ((s.stage === "fantasyDraft" || s.stage === "offseasonDraft") && s.draft) {
      return s.draft.pickOrder[s.draft.currentPickIndex] ?? null;
    }
    if (s.stage === "freeAgency" || s.stage === "midseasonFreeAgency") return faOnTheClock(s);
    if (s.stage === "coachingDraft") return coachingOnTheClock(s);
    if (s.stage === "tradeDeadline" && s.tradeDeadline) {
      const a = s.tradeDeadline.active;
      return a ? (a.awaiting === "recipient" ? a.toTeam : a.fromTeam) : deadlineOnTheClock(s);
    }
    return null;
  });
  const session = onlineSession();
  const step = useStore((st) => stepOf(st, st.viewerGmId));
  const screen = currentScreen(stage, step);
  // the tab title too: a league left open in a background tab is how most
  // async turns get noticed
  useEffect(() => {
    document.title = yourTurn ? "● Your turn — Franchise Sim" : "Franchise Sim";
  }, [yourTurn]);
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
            {session && <span style={{ display: "block", opacity: 0.7 }}>{session.leagueName}</span>}
          </div>
        </div>
        <div className="stagechip">
          {screen.label} · {displaySeasonFor(season, stage)}
          {week ? ` · Wk ${week}` : ""}
        </div>
        {session && <TurnClock stage={stage} yourTurn={yourTurn} team={clockTeam} />}

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
            <NavLink to={screen.route} className={active}>
              {screen.label}
              {yourTurn && (
                <span className="railbadge" aria-label="your turn">
                  Your turn
                </span>
              )}
            </NavLink>
            <div className="railgroup">Reference</div>
            {renderGroupedNav(OFFSEASON_REFERENCE_NAV, navBadges)}
          </>
        )}

        {session && !inSetup && <LeagueWire />}
        <div className="spacer" />
        {session && <TurnAlerts yourTurn={yourTurn} stageLabel={screen.label} />}
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
        {!onlineSession() && <SaveBackup />}
        {/* a solo-save control: inside an online league it read as though it
            could wipe the league */}
        {!session && (
        <button
          className="reset"
          onClick={() => {
            // a new league starts at setup — staying on the current screen left
            // you looking at (say) rookie signings for a league with no team
            if (confirm("Start a brand-new solo dynasty? This clears the current save.")) {
              // and forgets an online league this browser couldn't reconnect
              // to — otherwise the new solo game is treated as a disconnected
              // copy of it, and every move is refused
              goLocal();
              void newLeague();
              navTo("/setup");
            }
          }}
          title="Solo play on this device. For a league real people can join, use Online leagues above."
        >
          New solo dynasty
        </button>
        )}
      </nav>
      <main className="app-main">
        {saveCorrupted && (
          <div className="notice bad" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
            <strong>Your saved dynasty couldn&rsquo;t be read.</strong> What you&rsquo;re looking at
            now is a fresh one, not the one you left — the old save was unreadable rather than
            gone, and a copy of the raw data has been kept in this browser's storage in case it can
            be recovered. Playing on from here will not get it back.
          </div>
        )}
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
