import { memo } from "react";
import { Link } from "react-router-dom";
import type { GameResult, ScheduledGame } from "@/domain";
import { TeamBadge } from "@/components/bits";
import { TEAMS_BY_CODE } from "@/data/teams";
import { MotionSurface, MotionMeter } from "@/motion/MotionSurface";
import { AnimatedNumber } from "@/motion/AnimatedNumber";
import { millions } from "@/util/format";
import "./dashboard.css";

interface Props {
  code: string; scheduleSeason: number; week: number; phase: "PRE" | "REG" | null;
  schedule: ScheduledGame[]; seenGames: GameResult[];
  cap: { used: number; total: number; dead?: number };
  units: Array<{ label: string; value: number; rank: number }>;
  offers: number;
}

/** Presentation only. Results are the viewer-filtered games supplied by the hub. */
export const DashboardOverview = memo(function DashboardOverview({
  code, scheduleSeason, week, phase, schedule, seenGames, cap, units, offers,
}: Props) {
  const games = schedule.filter(g => g.phase === (phase ?? "REG") && (g.homeTeam === code || g.awayTeam === code));
  const weeks = Array.from({ length: Math.max(0, ...games.map(g => g.week)) }, (_, i) => i + 1);
  const room = Math.round((cap.total - cap.used) * 10) / 10;
  return <div className="dashboard-overview" role="region" aria-label="Franchise dashboard">
    <div className="dashboard-main">
      <MotionSurface className="ui-surface season-track" index={0}>
        <div className="ui-section-heading">
          <div><h2>Season timeline</h2><p>{scheduleSeason} {phase === "PRE" ? "preseason" : "regular season"} · {phase ? "Your road ahead" : "Season results"}</p></div>
          <Link className="ui-text-link" to="/schedule">Full schedule <span aria-hidden="true">↗</span></Link>
        </div>
        <ol className="season-track__games" tabIndex={0} aria-label="Your season schedule">
          {weeks.map(w => {
            const g = games.find(g => g.week === w);
            if (!g) return <li key={"bye-" + w} data-week={w}
              aria-current={phase && w === week ? "step" : undefined}
              className={"season-game" + (phase && w === week ? " season-game--current" : "")}>
              <span className="season-game__week">W{w}</span><span className="season-game__bye" aria-hidden="true">—</span>
              <strong>Bye</strong><span className="season-game__score">No game</span>
            </li>;
            const opponent = g.homeTeam === code ? g.awayTeam : g.homeTeam;
            const result = seenGames.find(r => r.phase === g.phase && r.week === g.week && r.homeTeam === g.homeTeam && r.awayTeam === g.awayTeam && r.played);
            const ours = result ? (g.homeTeam === code ? result.homeScore : result.awayScore) : null;
            const theirs = result ? (g.homeTeam === code ? result.awayScore : result.homeScore) : null;
            const outcome = ours === null || theirs === null ? null : ours > theirs ? "W" : ours < theirs ? "L" : "T";
            return <li data-week={g.week} data-team={opponent} key={g.phase + "-" + g.week} aria-current={phase && g.week === week ? "step" : undefined}
              className={"season-game" + (phase && g.week === week ? " season-game--current" : "")}>
              <span className="season-game__week">W{g.week}</span>
              <TeamBadge code={opponent} size={36} />
              <span className="season-game__team">{TEAMS_BY_CODE[opponent]?.abbr ?? opponent}</span>
              {result ? <><strong className={outcome === "W" ? "good" : outcome === "L" ? "bad" : ""}>{outcome}</strong><span className="season-game__score">{ours}–{theirs}</span></> :
                <><span className="season-game__site">{g.homeTeam === code ? "Home" : "Away"}</span><span className="season-game__score">Upcoming</span></>}
            </li>;
          })}
        </ol>
        <p className="ui-caption">Published matchups. Scores appear only after you have seen the result.</p>
      </MotionSurface>
      <MotionSurface className="ui-surface front-office" index={1}>
        <div className="ui-section-heading"><div><h2>Your front office</h2><p>Build the team. Make your next move.</p></div><span className="ui-orbit" aria-hidden="true">↗</span></div>
        <div className="front-office__links">
          <Link to="/roster" className="decision-link decision-link--teal"><span className="decision-icon" aria-hidden="true">◎</span><span><strong>Roster &amp; cap</strong><small>Depth chart, contracts and roster decisions</small></span><span aria-hidden="true">→</span></Link>
          <Link to="/trade" className="decision-link decision-link--purple"><span className="decision-icon" aria-hidden="true">⇄</span><span><strong>Trade proposals</strong><small>{offers ? offers + " offer" + (offers === 1 ? "" : "s") + " waiting for you" : "Explore deals and review proposals"}</small></span><span aria-hidden="true">→</span></Link>
          <Link to="/coaching" className="decision-link decision-link--blue"><span className="decision-icon" aria-hidden="true">⌁</span><span><strong>Coaching staff</strong><small>The people behind the playbook</small></span><span aria-hidden="true">→</span></Link>
        </div>
      </MotionSurface>
    </div>
    <div className="dashboard-side">
      <MotionSurface className="ui-surface unit-pulse" index={2}>
        <div className="ui-section-heading"><div><h2>Roster pulse</h2><p>Current unit ratings · 0–100</p></div><span className="ui-status-dot" aria-hidden="true" /></div>
        {units.map((unit, i) => <div className="unit-pulse__row" key={unit.label}>
          <div><span>{unit.label}</span><strong><AnimatedNumber value={unit.value} /></strong></div>
          <MotionMeter value={unit.value} label={unit.label + " rating"} tone={i === 3 ? "purple" : i === 2 ? "gold" : "teal"} />
          <small>{unit.rank > 0 ? "League rank " + unit.rank : "Not ranked yet"}</small>
        </div>)}
      </MotionSurface>
      <MotionSurface className="ui-surface cap-snapshot" index={3}>
        <div className="ui-section-heading"><div><h2>Finances &amp; cap</h2><p>Your current salary-cap position</p></div><Link className="ui-text-link" to="/roster">Details ↗</Link></div>
        <div className="cap-snapshot__figure"><span>Cap room</span><strong className={room < 0 ? "bad" : "good"}><AnimatedNumber value={room} format={millions} /></strong></div>
        <MotionMeter value={cap.used} max={cap.total} label="Salary cap used" tone="blue" />
        <dl><div><dt>Used</dt><dd>{millions(cap.used)}</dd></div><div><dt>Salary cap</dt><dd>{millions(cap.total)}</dd></div><div><dt>Dead money</dt><dd>{millions(cap.dead ?? 0)}</dd></div></dl>
      </MotionSurface>
    </div>
  </div>;
});

