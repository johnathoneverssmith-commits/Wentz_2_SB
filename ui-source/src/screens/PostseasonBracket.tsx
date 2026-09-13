import { useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { BracketMatchup, PlayoffRound } from "@/domain";
import { record, ROUND_LABEL, winPct } from "@/domain";
import { useStore } from "@/state/store";
import { viewerTeamCode } from "@/state/selectors";
import { ordinal } from "@/util/format";

export function PostseasonBracket() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("afc");
  const code = viewerTeamCode(s);
  const simulateGameDay = useStore((st) => st.simulateGameDay);
  const b = s.bracket;

  if (!b) {
    const inHunt = (conf: "AFC" | "NFC") =>
      Object.values(s.teams)
        .filter((t) => TEAMS_BY_CODE[t.code]?.conference === conf)
        .sort((x, y) => winPct(y) - winPct(x) || y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst))
        .slice(0, 7);
    const started = s.games.some((g) => g.phase === "REG" && g.played);
    return (
      <Card maxWidth={940}>
        <CardHeader badge="NFL" title="Postseason" subtitle={`${s.season} playoffs · not seeded yet`} />
        <div className="panel open">
          <div className="emptystate" style={{ marginBottom: started ? 20 : 0 }}>
            The bracket is seeded when the regular season ends
            {started ? " — here's how the field looks right now." : "."}
          </div>
          {started && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {(["AFC", "NFC"] as const).map((conf) => (
                <div key={conf}>
                  <p className="subhead" style={{ marginTop: 0 }}>
                    {conf} — current top 7
                  </p>
                  <table className="stbl">
                    <tbody>
                      {inHunt(conf).map((t, i) => (
                        <tr key={t.code} className={t.code === code ? "highlight" : ""}>
                          <td className="c" style={{ width: 22, color: "var(--ink-faint)" }}>{i + 1}</td>
                          <td className="name">{TEAMS_BY_CODE[t.code]!.city}</td>
                          <td className="r">{record(t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
        <Footer>
          <button type="button" className="btnlink" onClick={() => nav("/hub")}>
            Team hub
          </button>
          <button type="button" className="btnlink" onClick={() => nav("/schedule")}>
            Full schedule
          </button>
        </Footer>
      </Card>
    );
  }

  const inField = code && (b.seeds.AFC.includes(code) || b.seeds.NFC.includes(code));
  const mySeed = code ? ([...b.seeds.AFC, ...b.seeds.NFC].indexOf(code) % 7) + 1 : 0;
  const myNext = code
    ? b.matchups.find((m) => m.winner == null && (m.highSeed?.code === code || m.lowSeed?.code === code))
    : undefined;
  const myNextOpp = myNext
    ? myNext.highSeed?.code === code
      ? myNext.lowSeed?.code
      : myNext.highSeed?.code
    : undefined;
  const eliminated =
    inField &&
    !myNext &&
    b.champion !== code &&
    b.matchups.some(
      (m) => m.winner && m.winner !== code && (m.highSeed?.code === code || m.lowSeed?.code === code),
    );

  const isPlayoffStage = s.stage === "playoffs";

  return (
    <Card maxWidth={960}>
      <CardHeader badge="NFL" title="Postseason" subtitle={`${ROUND_LABEL[b.currentRound]} · ${s.season} playoffs`} />
      <Ticker
        stats={[
          {
            label: "Your team",
            value: b.champion === code ? "Champion" : eliminated ? "Eliminated" : inField ? "Alive" : "Missed",
            className: "accent",
          },
          { label: "Seed", value: inField ? `${mySeed} (${TEAMS_BY_CODE[code!]!.conference})` : "—" },
          { label: "Next game", value: myNextOpp ? `vs ${TEAMS_BY_CODE[myNextOpp]!.city}` : b.champion ? "—" : "TBD", className: "sm" },
          { label: "Champion", value: b.champion ? TEAMS_BY_CODE[b.champion]!.city : "—", className: "sm" },
        ]}
      />
      <Tabs
        tabs={[
          { id: "afc", label: "AFC" },
          { id: "nfc", label: "NFC" },
          { id: "sb", label: "Super Bowl" },
        ]}
        active={active}
        onChange={setActive}
      />

      {(["afc", "nfc"] as const).map((conf) => (
        <Panel key={conf} open={active === conf}>
          <ConferenceBracket conf={conf.toUpperCase() as "AFC" | "NFC"} matchups={b.matchups} me={code} />
        </Panel>
      ))}

      <Panel open={active === "sb"}>
        <div style={{ maxWidth: 340, margin: "0 auto" }}>
          {b.matchups
            .filter((m) => m.round === "SB")
            .map((m, i) => (
              <MatchBox key={i} m={m} me={code} />
            ))}
          {b.matchups.filter((m) => m.round === "SB").length === 0 && (
            <div className="emptystate">Set once both conference championships are decided.</div>
          )}
        </div>
      </Panel>

      <Footer>
        <button type="button" className="btnlink" onClick={() => nav("/hub")}>
          Team hub
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/roster")}>
          Roster &amp; Cap
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/player-stats")}>
          Player Statistics
        </button>
      </Footer>

      {isPlayoffStage && s.pendingGameDay && (
        // a round has been played but not "continued" from Game Day yet (this
        // is also how the Super Bowl result is left after it sims) — offer
        // the way forward instead of the gate, which would sim again
        <div className="readiness">
          <div className="readiness-top">
            <p>{b.champion ? "The Super Bowl has been played" : `${ROUND_LABEL[s.pendingGameDay.phase as PlayoffRound]} results are in`}</p>
            <span>Continue from Game Day to move on</span>
          </div>
          <button type="button" className="btn-primary" style={{ width: "100%" }} onClick={() => nav("/game-day")}>
            {b.champion ? "See the final result" : "View round results"}
          </button>
        </div>
      )}
      {isPlayoffStage && !s.pendingGameDay && !b.champion && (
        <ReadinessGate
          title={`${ROUND_LABEL[b.currentRound]} readiness`}
          label={`Simulate the ${ROUND_LABEL[b.currentRound]}`}
          action={simulateGameDay}
          onAdvance={(r) => nav(r)}
        />
      )}
    </Card>
  );
}

/* ---- a vertically-centred 3-column bracket with elbow connectors ---- */

function ConferenceBracket({
  conf,
  matchups,
  me,
}: {
  conf: "AFC" | "NFC";
  matchups: BracketMatchup[];
  me: string | undefined;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const wc = useRef<HTMLDivElement>(null);
  const div = useRef<HTMLDivElement>(null);
  const cc = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);

  const rows = (round: BracketMatchup["round"]) =>
    matchups.filter((m) => m.round === round && m.conference === conf);

  useLayoutEffect(() => {
    const draw = () => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const mid = (el: Element | null | undefined) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left - wr.left, r: r.right - wr.left, y: r.top + r.height / 2 - wr.top };
      };
      const next: string[] = [];
      const connect = (srcs: (Element | undefined)[], dst: Element | undefined) => {
        const d = mid(dst);
        if (!d) return;
        const s = srcs.map(mid).filter(Boolean) as { l: number; r: number; y: number }[];
        if (s.length === 0) return;
        const midX = (s[0]!.r + d.l) / 2;
        for (const p of s) next.push(`M ${p.r} ${p.y} H ${midX} V ${d.y}`);
        next.push(`M ${midX} ${d.y} H ${d.l}`);
      };
      const wcEls = Array.from(wc.current?.children ?? []);
      const divEls = Array.from(div.current?.children ?? []);
      const ccEls = Array.from(cc.current?.children ?? []);
      if (wcEls.length >= 4 && divEls.length >= 2) {
        connect([wcEls[0], wcEls[1]], divEls[0]);
        connect([wcEls[2], wcEls[3]], divEls[1]);
      }
      if (divEls.length >= 2 && ccEls.length >= 1) connect([divEls[0], divEls[1]], ccEls[0]);
      setPaths(next);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [matchups, conf]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}>
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--line-strong)" strokeWidth={1} />
        ))}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 40 }}>
        {(["WC", "DIV", "CONF"] as const).map((round, ci) => (
          <div key={round}>
            <p className="subhead" style={{ textAlign: "center", marginTop: 0 }}>
              {ROUND_LABEL[round]}
            </p>
            <div
              ref={ci === 0 ? wc : ci === 1 ? div : cc}
              style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", minHeight: 300, gap: 14 }}
            >
              {rows(round).length > 0 ? (
                rows(round).map((m, i) => <MatchBox key={i} m={m} me={me} />)
              ) : (
                <div className="emptystate" style={{ padding: "18px 8px" }}>
                  TBD
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchBox({ m, me }: { m: BracketMatchup; me: string | undefined }) {
  const yours = m.highSeed?.code === me || m.lowSeed?.code === me;
  const played = m.homeScore != null && m.awayScore != null;
  const bye = m.round === "WC" && !m.lowSeed;

  const row = (side: BracketMatchup["highSeed"], score: number | null, isWinner: boolean) => {
    if (!side) return <div style={{ padding: "9px 12px", color: "var(--ink-faint)", fontStyle: "italic", fontSize: 13 }}>TBD</div>;
    const t = TEAMS_BY_CODE[side.code]!;
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", gap: 8, background: isWinner ? "rgba(111,200,150,0.07)" : undefined }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span className="oswald" style={{ width: 20, height: 20, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: t.color, color: t.onColor }}>
            {side.seed || "•"}
          </span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{t.city}</span>
        </div>
        {score != null && (
          <span className="oswald" style={{ fontSize: 14, fontWeight: 600, color: isWinner ? "var(--good)" : "var(--ink-dim)" }}>
            {score}
          </span>
        )}
      </div>
    );
  };
  const highWin = played && (m.homeScore ?? 0) > (m.awayScore ?? 0);
  const lowWin = played && (m.awayScore ?? 0) > (m.homeScore ?? 0);

  const favCode = m.highSeed && m.lowSeed
    ? m.favoredWinProb >= 50
      ? m.highSeed.code
      : m.lowSeed.code
    : null;
  const favProb = m.favoredWinProb >= 50 ? m.favoredWinProb : 100 - m.favoredWinProb;

  return (
    <div style={{ background: "var(--panel-sunken)", border: `1px ${bye ? "dashed" : "solid"} ${yours ? "color-mix(in srgb, var(--team) 48%, transparent)" : "var(--line)"}`, borderRadius: 8, overflow: "hidden" }}>
      {row(m.highSeed, played ? m.homeScore : null, highWin || (bye && !!m.winner))}
      {!bye && <div style={{ borderTop: "1px solid var(--line)" }}>{row(m.lowSeed, played ? m.awayScore : null, lowWin)}</div>}
      {bye && <div style={{ padding: "4px 12px 9px", fontSize: 9.5, color: "var(--ink-faint)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Bye — auto-advance</div>}
      {!played && !bye && favCode && (
        <div style={{ padding: "6px 12px 9px", fontSize: 11, color: "var(--good)", textAlign: "center", borderTop: "1px solid var(--line)" }}>
          {/* "favored · 50%" is a contradiction, and two evenly matched teams
              land there often enough to notice */}
          {favProb === 50
            ? "Pick 'em · 50%"
            : `${TEAMS_BY_CODE[favCode]!.city} favored · ${favProb}%`}
        </div>
      )}
    </div>
  );
}

export { ordinal };
