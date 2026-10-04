import { TEAMS_BY_CODE } from "@/data/teams";
import type { LeagueState } from "@/domain";
import { roundLabelFor } from "@/domain";
import { AWARD_LABEL, NFL_RECORDS, RECORD_LABEL, type SeasonAward } from "@/state/seasonAwards";
import { posLabel } from "@/util/format";

const abbr = (code: string | null | undefined) => (code ? (TEAMS_BY_CODE[code]?.abbr ?? code) : "—");

/** "Lost in the Divisional Round", from a human team's own season record when there is one. */
function playoffExit(s: LeagueState, teamCode: string, season: number): string {
  const out = s.history.find((h) => h.season === season && h.teamCode === teamCode);
  const round = out?.furthestRound;
  if (!round || round === "none") return "Playoffs";
  const format = s.config.leagueFormat === "humansOnly" ? ({ format: "single" } as const) : null;
  return `Lost in the ${roundLabelFor(format, round)}`;
}

/**
 * What the league remembers: its champions, single-season records, the most
 * recent All-Pro first team and the Hall of Fame. Each section appears once
 * there is something in it.
 */
export function LeagueMemory({ s, teamCode }: { s: LeagueState; teamCode?: string | null }) {
  const mine = teamCode ? (s.teamSeasons ?? []).filter((r) => r.team === teamCode).sort((a, b) => b.season - a.season) : [];
  const champions = [...(s.champions ?? [])].sort((a, b) => b.season - a.season);
  const records = s.records ?? [];
  const latestAllPro = Math.max(0, ...(s.allPro ?? []).map((a) => a.season));
  const allPro = (s.allPro ?? []).filter((a) => a.season === latestAllPro);
  const hof = [...(s.hallOfFame ?? [])].sort((a, b) => b.inducted - a.inducted);
  const careers = careerLeaders(s);
  if (!champions.length && !records.length && !allPro.length && !hof.length && !careers.length && !mine.length) return null;

  const title: React.CSSProperties = { margin: "0 0 8px" };
  const row: React.CSSProperties = { fontSize: 12.5, display: "flex", gap: 8, flexWrap: "wrap", padding: "3px 0" };

  return (
    <div className="panel open" style={{ display: "grid", gap: 20 }}>
      {mine.length > 0 && (
        <section>
          <p className="sectionlabel" style={title}>
            {TEAMS_BY_CODE[teamCode!]?.label ?? teamCode} by season
          </p>
          {mine.map((r) => (
            <div key={r.season} style={row}>
              <strong style={{ minWidth: 44 }}>{r.season}</strong>
              <span style={{ minWidth: 60 }}>
                {r.wins}-{r.losses}
                {r.ties ? `-${r.ties}` : ""}
              </span>
              <span style={{ color: r.finish === "champion" ? "var(--good)" : "var(--ink-dim)", minWidth: 90 }}>
                {r.finish === "champion"
                  ? "Champions"
                  : r.finish === "runner-up"
                    ? "Runner-up"
                    : r.finish === "playoffs"
                      ? // "Playoffs" alone, every year — which round is the history
                        playoffExit(s, teamCode!, r.season)
                      : "—"}
              </span>
              <span style={{ color: "var(--ink-faint)" }}>
                {r.pointsFor}-{r.pointsAgainst}
                {r.headCoach ? ` · HC ${r.headCoach}` : ""}
              </span>
            </div>
          ))}
        </section>
      )}

      {champions.length > 0 && (
        <section>
          <p className="sectionlabel" style={title}>
            Champions
          </p>
          {champions.map((c) => (
            <div key={c.season} style={row}>
              <strong style={{ minWidth: 44 }}>{c.season}</strong>
              <span>{TEAMS_BY_CODE[c.champion]?.label ?? c.champion}</span>
              {c.runnerUp && <span style={{ color: "var(--ink-faint)" }}>over {abbr(c.runnerUp)}</span>}
            </div>
          ))}
        </section>
      )}

      {records.length > 0 && (
        <section>
          <p className="sectionlabel" style={title}>
            Single-season records
          </p>
          {records.map((r) => (
            <div key={r.stat} style={row}>
              <span style={{ color: "var(--ink-faint)", minWidth: 170 }}>{RECORD_LABEL[r.stat]}</span>
              {/* "5231" here and "10,204" in the career list below */}
              <strong>{r.value.toLocaleString("en-US")}</strong>
              <span>
                {r.name} · {abbr(r.team)} · {r.season}
              </span>
              {NFL_RECORDS[r.stat] && (
                <span
                  style={{ color: r.value > NFL_RECORDS[r.stat]!.value ? "var(--good)" : "var(--ink-faint)" }}
                  title={`NFL record: ${NFL_RECORDS[r.stat]!.holder}`}
                >
                  {r.value > NFL_RECORDS[r.stat]!.value ? "beats" : "NFL"} {NFL_RECORDS[r.stat]!.value.toLocaleString("en-US")}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {allPro.length > 0 && (
        <section>
          <p className="sectionlabel" style={title}>
            {latestAllPro} All-Pro first team
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "2px 16px" }}>
            {allPro.map((a) => (
              <div key={a.playerId} style={{ fontSize: 12.5 }}>
                <span style={{ color: "var(--ink-faint)", display: "inline-block", minWidth: 42 }}>{posLabel(a.position)}</span>
                {a.name} <span style={{ color: "var(--ink-faint)" }}>{abbr(a.team)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {careers.length > 0 && (
        <section>
          <p className="sectionlabel" style={title}>
            Career leaders
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "10px 20px" }}>
            {careers.map((c) => (
              <div key={c.label}>
                <p style={{ margin: "0 0 4px", fontSize: 11.5, color: "var(--ink-faint)" }}>{c.label}</p>
                {c.rows.map((r, i) => (
                  <div key={r.id} style={{ fontSize: 12, display: "flex", gap: 6 }}>
                    <span style={{ color: "var(--ink-faint)", minWidth: 14 }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>
                      {r.name}
                      {r.retired ? <span style={{ color: "var(--ink-faint)" }}> (ret.)</span> : null}
                    </span>
                    <strong>{r.value.toLocaleString("en-US")}</strong>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {hof.length > 0 && (
        <section>
          <p className="sectionlabel" style={title}>
            Hall of Fame
          </p>
          {hof.map((h) => (
            <div key={h.playerId} style={row}>
              <strong>{h.name}</strong>
              <span style={{ color: "var(--ink-dim)" }}>
                {posLabel(h.position)} · {h.seasons} seasons · {h.why} · inducted {h.inducted}
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

/** One season's award winners, as a compact list. */
export function SeasonAwardsList({ awards }: { awards: SeasonAward[] }) {
  if (awards.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 4, textAlign: "left", maxWidth: 520, margin: "0 auto" }}>
      {awards.map((a) => (
        <div key={a.award} style={{ fontSize: 12.5, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--ink-faint)", minWidth: 200 }}>{AWARD_LABEL[a.award]}</span>
          <strong>{a.name}</strong>
          <span style={{ color: "var(--ink-dim)" }}>
            {posLabel(a.position)} · {abbr(a.team)}
          </span>
        </div>
      ))}
    </div>
  );
}

const CAREER_STATS: [string, "passYds" | "passTd" | "rushYds" | "rushTd" | "recYds" | "recTd" | "sacks" | "defInt" | "tackles"][] = [
  ["Passing yards", "passYds"],
  ["Passing touchdowns", "passTd"],
  ["Rushing yards", "rushYds"],
  ["Rushing touchdowns", "rushTd"],
  ["Receiving yards", "recYds"],
  ["Receiving touchdowns", "recTd"],
  ["Sacks", "sacks"],
  ["Interceptions", "defInt"],
  ["Tackles", "tackles"],
];

/**
 * Top five in each career total: the league's all-time book
 * (`careerRecords`, which outlives a pruned retiree), topped up with anyone
 * whose career is in the save now.
 */
function careerLeaders(s: LeagueState) {
  const players = Object.values(s.players).filter((p) => p.career && p.career.seasons > 0);
  const banked = s.careerRecords ?? [];
  if (players.length === 0 && banked.length === 0) return [];
  return CAREER_STATS.map(([label, key]) => {
    const byId = new Map<string, { id: string; name: string; retired: boolean; value: number }>();
    for (const r of banked.filter((r) => r.stat === key)) {
      const p = s.players[r.playerId];
      byId.set(r.playerId, { id: r.playerId, name: r.name, retired: !p || !!p.retired, value: r.value });
    }
    for (const p of players) {
      const value = p.career?.[key] ?? 0;
      if (value > (byId.get(p.id)?.value ?? 0)) byId.set(p.id, { id: p.id, name: p.name, retired: !!p.retired, value });
    }
    return {
      label,
      rows: [...byId.values()]
        .filter((r) => r.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
    };
  }).filter((c) => c.rows.length > 0);
}
