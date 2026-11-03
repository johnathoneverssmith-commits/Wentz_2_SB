import { useId, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill, pressable } from "@/components/bits";
import { PlayerStatsModal } from "@/components/PlayerStatsModal";
import { Footer, Ticker } from "@/components/primitives";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "./office-gameday.css";
import { TEAMS } from "@/data/teams";
import { POSITION_GROUPS, POSITION_TO_GROUP, type Player } from "@/domain";
import { useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { ordinal, posLabel } from "@/util/format";
import { sideRatings } from "@/state/unitReport";

export function LeagueRosters() {
  const nav = useNavigate();
  const s = useStore();
  const myCode = viewerTeamCode(s);
  const [teamCode, setTeamCode] = useState(() => myCode ?? TEAMS.find((t) => s.teams[t.code])!.code);
  const [inspect, setInspect] = useState<Player | null>(null);
  const pickId = useId();

  const roster = useMemo(() => teamRoster(s, teamCode), [s, teamCode]);
  const team = s.teams[teamCode]!;
  // engine-weighted, as the hub and Roster & Cap rank units
  const sides = useMemo(
    () => sideRatings({ players: s.players, teams: s.teams, depthChart: s.depthChart }),
    [s.players, s.teams, s.depthChart],
  );
  // whose team it is, when it's a person's
  const gm = s.gms.find((g) => g.isHuman && g.teamCode === teamCode);

  return (
    // the page wears the team being looked at, not only the viewer's own
    <GdPage code={teamCode}>
      <GameDayMasthead
        code={teamCode}
        compact
        title={
          gm
            ? `${gm.id === s.viewerGmId ? "Your team" : `Run by ${gm.name}`}. Tap a name for full stats.`
            : "Read-only depth chart for any team. Tap a name for full stats."
        }
        heading="League rosters"
        sub="Every team's players, by position group."
        actions={
          <div className="gd-pick">
            <label htmlFor={pickId}>Team</label>
            <select id={pickId} value={teamCode} onChange={(e) => setTeamCode(e.target.value)}>
              {TEAMS.filter((t) => s.teams[t.code]).map((t) => (
                <option key={t.code} value={t.code}>
                  {t.city} {t.name}
                </option>
              ))}
            </select>
          </div>
        }
      />
      <Ticker
        stats={[
          { label: "Team overall", value: `${team.ratings.overall} (${ordinal(team.ratings.overallRank)})` },
          { label: "Offense", value: ordinal(sides[teamCode]?.offenseRank ?? team.ratings.offenseRank), className: "sm" },
          { label: "Defense", value: ordinal(sides[teamCode]?.defenseRank ?? team.ratings.defenseRank), className: "sm" },
          { label: "Players", value: roster.length },
        ]}
      />
      <div className="gd-lr">
        {POSITION_GROUPS.map((g) => {
          const players = roster.filter((p) => POSITION_TO_GROUP[p.position] === g);
          if (players.length === 0) return null;
          return (
            <section key={g} className="gd-lr__group" aria-label={g}>
              <p className="subhead gd-lr__head">{g}</p>
              <div className="gd-lr__cols" aria-hidden="true">
                <span>#</span>
                <span>Player</span>
                <span>OVR</span>
                <span>Age</span>
              </div>
              {players.map((p, i) => (
                <div key={p.id} {...pressable(() => setInspect(p))} className="gd-lr__row">
                  <span className="rank-num">{i + 1}</span>
                  <span className="pname">
                    <b>{p.name}</b> <span className="ppos">{posLabel(p.position)}</span>
                    {/* scouting a trade partner: who's hurt, and what they cost */}
                    {p.injury_status && <span className="gd-lr__hurt"> {p.injury_status.status.toUpperCase()}</span>}
                    {/* under the name, not a column: a fifth column left names
                        sixty pixels wide on a phone */}
                    <span className="gd-lr__deal">
                      {p.contract
                        ? `${p.contract.years_remaining}y · $${(p.contract.cap_hit_by_year[0] ?? 0).toFixed(1)}M`
                        : "No contract"}
                    </span>
                  </span>
                  <OvrPill value={p.overall} />
                  <span className="pcell">{p.age}</span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/roster")}>
          Your roster
        </button>
      </Footer>

      {inspect && <PlayerStatsModal player={inspect} portrait={false} onClose={() => setInspect(null)} />}
    </GdPage>
  );
}
