import { useMemo, useState } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import { bracketRounds, roundLabelFor, type BracketMatchup, type BracketState } from "@/domain";
import { productionRanks } from "@/state/productionRanks";
import { sideRatings } from "@/state/unitReport";
import { useStore } from "@/state/store";

import { MatchupBoard } from "./MatchupBoard";

const recordText = (t: { wins: number; losses: number; ties: number } | undefined): string =>
  t ? `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}` : "0-0";

/**
 * A matchup for every game in a round that has a GM's team in it — the same
 * board the weekly hub shows, so the people in a playoff game can see what
 * decides it. A round is picked from the chips; the current one opens first.
 */
export function PostseasonMatchups({ b }: { b: BracketState }) {
  const teams = useStore((s) => s.teams);
  const players = useStore((s) => s.players);
  const depthChart = useStore((s) => s.depthChart);
  const gms = useStore((s) => s.gms);
  const viewer = useStore((s) => s.viewerGmId);
  const mine = gms.find((g) => g.id === viewer)?.teamCode;

  const rounds = bracketRounds(b).filter((r) => b.matchups.some((m) => m.round === r && m.highSeed && m.lowSeed));
  const [picked, setPicked] = useState<string | null>(null);
  const round = (picked && rounds.includes(picked as never) ? picked : rounds.includes(b.currentRound) ? b.currentRound : rounds[0]) as
    | BracketMatchup["round"]
    | undefined;

  const allGames = useStore((s) => s.games);
  // the regular season each team brought to January
  const produced = useMemo(() => productionRanks({ teams }, allGames), [teams, allGames]);
  const sides = useMemo(
    () => sideRatings({ players, teams, depthChart } as Parameters<typeof sideRatings>[0]),
    [players, teams, depthChart],
  );
  const humanTeams = new Set(gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
  const gmOf = (code: string) => gms.find((g) => g.isHuman && g.teamCode === code)?.name;

  if (!round) return <div className="emptystate">No matchups are set yet.</div>;

  const games = b.matchups
    .filter((m) => m.round === round && m.highSeed && m.lowSeed)
    .filter((m) => humanTeams.has(m.highSeed!.code) || humanTeams.has(m.lowSeed!.code))
    // the viewer's own game first
    .sort((x, y) => Number(y.highSeed!.code === mine || y.lowSeed!.code === mine) - Number(x.highSeed!.code === mine || x.lowSeed!.code === mine));

  return (
    <div>
      <div role="tablist" aria-label="Round" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {rounds.map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={r === round}
            className={r === round ? "btn-primary" : "btnlink"}
            style={{ padding: "5px 12px", fontSize: 12 }}
            onClick={() => setPicked(r)}
          >
            {roundLabelFor(b, r)}
          </button>
        ))}
      </div>
      {games.length === 0 && <div className="emptystate">No GM&rsquo;s team plays in this round.</div>}
      {games.map((m) => {
        const hi = m.highSeed!.code;
        const lo = m.lowSeed!.code;
        // your team on the left when you're in it; otherwise the higher seed
        const [a, z] = lo === mine ? [lo, hi] : [hi, lo];
        const aIsHigh = a === hi;
        const pA = aIsHigh ? m.favoredWinProb : 100 - m.favoredWinProb;
        const ta = teams[a];
        const tz = teams[z];
        if (!ta || !tz) return null;
        const names = [TEAMS_BY_CODE[a]?.abbr ?? a, TEAMS_BY_CODE[z]?.abbr ?? z] as [string, string];
        return (
          <div key={`${m.conference}-${hi}-${lo}`} style={{ marginBottom: 28 }}>
            <MatchupBoard
              when={roundLabelFor(b, round)}
              note={[gmOf(a), gmOf(z)].filter(Boolean).join(" vs ") || undefined}
              me={{ code: a, record: recordText(ta), site: m.round === "SB" ? "neutral" : aIsHigh ? "home" : "away" }}
              them={{ code: z, record: recordText(tz), site: m.round === "SB" ? "neutral" : aIsHigh ? "away" : "home" }}
              winProb={Math.round(pA)}
              names={names}
              metrics={[
                { label: "Team overall", a: ta.ratings.overall, b: tz.ratings.overall },
                { label: produced ? "Offense rank (points scored)" : "Offense rank", rank: true, a: produced?.get(a)?.offense ?? sides[a]?.offenseRank ?? ta.ratings.offenseRank, b: produced?.get(z)?.offense ?? sides[z]?.offenseRank ?? tz.ratings.offenseRank },
                { label: produced ? "Defense rank (points allowed)" : "Defense rank", rank: true, a: produced?.get(a)?.defense ?? sides[a]?.defenseRank ?? ta.ratings.defenseRank, b: produced?.get(z)?.defense ?? sides[z]?.defenseRank ?? tz.ratings.defenseRank },
                { label: produced?.get(a)?.specialTeams != null ? "Special teams rank (kicking points)" : "Special teams rank", rank: true, a: produced?.get(a)?.specialTeams ?? ta.ratings.specialTeamsRank, b: produced?.get(z)?.specialTeams ?? tz.ratings.specialTeamsRank },
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}
