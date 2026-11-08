import { Link } from "react-router-dom";

import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";

const SCREENS: Array<{ to: string; title: string; note: string }> = [
  { to: "/setup", title: "League Setup", note: "Lobby, team select, rules" },
  { to: "/draft", title: "Draft Room", note: "Fantasy + rookie draft" },
  { to: "/fantasy-draft-summary", title: "Fantasy Draft Summary", note: "Draft grades" },
  { to: "/coaching", title: "Coaching Staff Hub", note: "Staff, search, scheme fit" },
  { to: "/roster", title: "Roster & Cap", note: "Depth chart, cap, needs" },
  { to: "/league-rosters", title: "League Rosters", note: "Any team, read-only" },
  { to: "/trade", title: "Trade Proposal", note: "Builder + league vote" },
  { to: "/free-agency", title: "Free Agency", note: "Main + standing market" },
  { to: "/hub", title: "Weekly Team Hub", note: "Base screen" },
  { to: "/schedule", title: "Full Schedule", note: "18 weeks + byes" },
  { to: "/league-stats", title: "League Stats", note: "O / D / scoring / ST" },
  { to: "/player-stats", title: "Player Statistics", note: "Leaderboards + MVP" },
  { to: "/bracket", title: "Postseason Bracket", note: "WC → SB" },
  { to: "/retirement", title: "Retirement Review", note: "Retire / return" },
  { to: "/rookie-signings", title: "Rookie Signings", note: "Slotted deals" },
  { to: "/game-day", title: "Game Day", note: "Post-sim results" },
  { to: "/end-of-season", title: "End of Season", note: "Announcement" },
  { to: "/season-complete", title: "Season Complete", note: "Recap + score tracker" },
  { to: "/history", title: "League History", note: "Score tracker" },

  // The redesign's screens. They were built and shipped without ever being
  // opened by hand, because the routes are stage-guarded and there was no
  // league in the right stage to open them from — which is exactly the hole
  // this gallery exists to fill.
  { to: "/coaching-draft", title: "Coaching Draft Room", note: "12-round snake" },
  { to: "/coaching-draft-summary", title: "Coaching Draft Summary", note: "Staff grades" },
  { to: "/free-agency-board", title: "Free Agency (turns)", note: "5 rounds, one offer each" },
  { to: "/free-agency-summary", title: "Free Agency Summary", note: "Signings + reconciliation" },
  { to: "/training-camp", title: "Training Camp", note: "Position focuses" },
  { to: "/training-camp-results", title: "Training Camp Results", note: "Every delta" },
  { to: "/results/PRE/1/3", title: "Results (block)", note: "Weekly tabs" },
  { to: "/results/round/WC", title: "Results (playoff round)", note: "One round" },
  { to: "/trade-deadline", title: "Trade Deadline", note: "3 rounds of turns" },
  { to: "/trade-summary", title: "Trade Summary", note: "4 tabs + violations" },
  { to: "/rookie-draft-summary", title: "Rookie Draft Summary", note: "Round 1 grades" },
];

export function ScreenGallery() {
  const mine = useStore((st) => viewerTeamCode(st));
  return (
    <GdPage code={mine}>
      <GameDayMasthead code={mine ?? ""} compact title="Development" heading="Screen gallery" sub="Dev-only. Not part of the state machine." />
      <section className="ui-surface" aria-label="Screens">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))", gap: 10 }}>
          {SCREENS.map((sc) => (
            <Link key={sc.to} to={sc.to} className="gd-btn" style={{ display: "block", textDecoration: "none", textAlign: "left" }}>
              <span style={{ display: "block", fontWeight: 700 }}>{sc.title}</span>
              <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--gd-mute)" }}>{sc.note}</span>
            </Link>
          ))}
          <Link to="/visual-lab" className="gd-btn" style={{ display: "block", textDecoration: "none", textAlign: "left" }}>
            <span style={{ display: "block", fontWeight: 700 }}>Visual lab</span>
            <span style={{ display: "block", fontSize: 12, fontWeight: 400, color: "var(--gd-mute)" }}>Every stadium at three atmosphere levels</span>
          </Link>
        </div>
      </section>
    </GdPage>
  );
}
