import { Link } from "react-router-dom";

import { Card, CardHeader } from "@/components/primitives";

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
  { to: "/draft-preview", title: "Draft Preview", note: "Scouting + targets" },
  { to: "/game-day", title: "Game Day", note: "Post-sim results" },
  { to: "/end-of-season", title: "End of Season", note: "Announcement" },
  { to: "/season-complete", title: "Season Complete", note: "Recap + score tracker" },
  { to: "/history", title: "League History", note: "Score tracker" },
];

export function ScreenGallery() {
  return (
    <Card maxWidth={900}>
      <CardHeader badge="DEV" title="Screen Gallery" subtitle="Dev-only — not part of the state machine" />
      <div className="panel open">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {SCREENS.map((sc) => (
            <Link
              key={sc.to}
              to={sc.to}
              style={{ textDecoration: "none", color: "inherit", background: "var(--panel-sunken)", border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: 14 }}
            >
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{sc.title}</p>
              <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--ink-faint)" }}>{sc.note}</p>
            </Link>
          ))}
        </div>
      </div>
    </Card>
  );
}
