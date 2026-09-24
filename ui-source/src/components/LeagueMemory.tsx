import { TEAMS_BY_CODE } from "@/data/teams";
import type { LeagueState } from "@/domain";
import { AWARD_LABEL, RECORD_LABEL, type SeasonAward } from "@/state/seasonAwards";

const abbr = (code: string | null | undefined) => (code ? (TEAMS_BY_CODE[code]?.abbr ?? code) : "—");

/**
 * What the league remembers: its champions, single-season records, the most
 * recent All-Pro first team and the Hall of Fame. Each section appears once
 * there is something in it.
 */
export function LeagueMemory({ s }: { s: LeagueState }) {
  const champions = [...(s.champions ?? [])].sort((a, b) => b.season - a.season);
  const records = s.records ?? [];
  const latestAllPro = Math.max(0, ...(s.allPro ?? []).map((a) => a.season));
  const allPro = (s.allPro ?? []).filter((a) => a.season === latestAllPro);
  const hof = [...(s.hallOfFame ?? [])].sort((a, b) => b.inducted - a.inducted);
  if (!champions.length && !records.length && !allPro.length && !hof.length) return null;

  const title: React.CSSProperties = { margin: "0 0 8px" };
  const row: React.CSSProperties = { fontSize: 12.5, display: "flex", gap: 8, flexWrap: "wrap", padding: "3px 0" };

  return (
    <div className="panel open" style={{ display: "grid", gap: 20 }}>
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
              <strong>{r.value}</strong>
              <span>
                {r.name} · {abbr(r.team)} · {r.season}
              </span>
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
                <span style={{ color: "var(--ink-faint)", display: "inline-block", minWidth: 42 }}>{a.position}</span>
                {a.name} <span style={{ color: "var(--ink-faint)" }}>{abbr(a.team)}</span>
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
                {h.position} · {h.seasons} seasons · {h.why} · inducted {h.inducted}
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
            {a.position} · {abbr(a.team)}
          </span>
        </div>
      ))}
    </div>
  );
}
