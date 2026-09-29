import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill, pressable, TeamBadge } from "@/components/bits";
import { PlayerStatsModal } from "@/components/PlayerStatsModal";
import { Card, CardHeader, Footer, Ticker } from "@/components/primitives";
import { TEAMS, TEAMS_BY_CODE } from "@/data/teams";
import { POSITION_GROUPS, POSITION_TO_GROUP, type Player } from "@/domain";
import { useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { ordinal } from "@/util/format";
import { sideRatings } from "@/state/unitReport";

export function LeagueRosters() {
  const nav = useNavigate();
  const s = useStore();
  const myCode = viewerTeamCode(s);
  const [teamCode, setTeamCode] = useState(() => myCode ?? TEAMS.find((t) => s.teams[t.code])!.code);
  const [inspect, setInspect] = useState<Player | null>(null);

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
    <Card maxWidth={820}>
      <CardHeader
        badge={TEAMS_BY_CODE[teamCode]!.abbr}
        title="League Rosters"
        subtitle={
          gm
            ? `${gm.id === s.viewerGmId ? "Your team" : `Run by ${gm.name}`} · click a name for full stats`
            : "Read-only depth chart for any team — click a name for full stats"
        }
        action={
          <select value={teamCode} onChange={(e) => setTeamCode(e.target.value)}>
            {TEAMS.filter((t) => s.teams[t.code]).map((t) => (
              <option key={t.code} value={t.code}>
                {t.city} {t.name}
              </option>
            ))}
          </select>
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
      <div className="panel open">
        {POSITION_GROUPS.map((g) => {
          const players = roster.filter((p) => POSITION_TO_GROUP[p.position] === g);
          if (players.length === 0) return null;
          return (
            <div key={g} style={{ marginBottom: 14 }}>
              <p className="subhead" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <TeamBadge code={teamCode} size={16} /> {g}
              </p>
              <div
                style={{ display: "grid", gridTemplateColumns: "24px 1fr 46px 40px", gap: 10, padding: "0 6px 4px", fontSize: 10, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}
              >
                <span>#</span>
                <span>Player</span>
                <span style={{ textAlign: "center" }}>OVR</span>
                <span style={{ textAlign: "center" }}>Age</span>
              </div>
              {players.map((p, i) => (
                <div
                  key={p.id}
                  {...pressable(() => setInspect(p))}
                  style={{ display: "grid", gridTemplateColumns: "24px 1fr 46px 40px", alignItems: "center", gap: 10, padding: "8px 6px", borderBottom: "1px solid var(--line)", cursor: "pointer", borderRadius: "var(--r-sm)" }}
                >
                  <span className="rank-num">{i + 1}</span>
                  <span className="pname" style={{ textDecoration: "underline", textDecorationColor: "var(--line-strong)" }}>
                    {p.name} <span className="ppos">{p.position}</span>
                    {/* scouting a trade partner: who's hurt, and what they cost */}
                    {p.injury_status && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--bad)", textDecoration: "none" }}>
                        {p.injury_status.status.toUpperCase()}
                      </span>
                    )}
                    {/* under the name, not a column: a fifth column left names
                        sixty pixels wide on a phone */}
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)", textDecoration: "none" }}>
                      {p.contract
                        ? `${p.contract.years_remaining}y · $${(p.contract.cap_hit_by_year[0] ?? 0).toFixed(1)}M`
                        : "No contract"}
                    </span>
                  </span>
                  <OvrPill value={p.overall} />
                  <span className="pcell">{p.age}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/roster")}>
          Your roster
        </button>
      </Footer>

      {inspect && <PlayerStatsModal player={inspect} onClose={() => setInspect(null)} />}
    </Card>
  );
}
