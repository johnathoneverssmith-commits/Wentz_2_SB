import { useLayoutEffect, useRef, useState } from "react";
import { GmLine } from "@/components/GmIdentity";
import type React from "react";
import { ExpiringContracts } from "@/components/ExpiringContracts";
import { PostseasonMatchups } from "@/components/PostseasonMatchups";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { onColorFor, TEAMS_BY_CODE } from "@/data/teams";
import type { BracketMatchup, PlayoffRound } from "@/domain";
import { bracketRounds, record, roundLabelFor, winPct } from "@/domain";
import { isHumansOnly, playoffFieldSize, leagueBadge } from "@/state/leagueFormat";
import { GamePlanStrip } from "@/components/GamePlanStrip";
import { onlineSession } from "@/state/online";
import { revealedRounds, visibleBracket } from "@/state/reveal";
import { useLeagueActions } from "@/state/useLeagueActions";
import { useStore } from "@/state/store";
import { viewerTeamCode } from "@/state/selectors";
import { ordinal } from "@/util/format";

export function PostseasonBracket() {
  const nav = useNavigate();
  const s = useStore();
  const single = isHumansOnly(s);
  const code = viewerTeamCode(s);
  // open on your own conference, not always the AFC
  const { active, setActive } = useTabs(
    single ? "bracket" : TEAMS_BY_CODE[code ?? ""]?.conference === "NFC" ? "nfc" : "afc",
  );
  const simulateGameDay = useStore((st) => st.simulateGameDay);
  // Online the saved bracket already holds the whole postseason, so what
  // this screen renders is the GM's own view of it — see `visibleBracket`.
  const b = s.bracket
    ? onlineSession()
      ? visibleBracket(s.bracket, s, s.viewerGmId)
      : s.bracket
    : null;

  if (!b) {
    // Seeded the way the bracket will be (tiebreakers aside): the four
    // division leaders take 1-4, then the three best records left. Sorting on
    // record alone listed a 10-7 wild card above a 9-8 division winner.
    const byRecord = (x: (typeof s.teams)[string], y: (typeof s.teams)[string]) =>
      winPct(y) - winPct(x) || y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst);
    const inHunt = (conf: "AFC" | "NFC") => {
      const teams = Object.values(s.teams).filter((t) => TEAMS_BY_CODE[t.code]?.conference === conf);
      const leaders = [...new Set(teams.map((t) => TEAMS_BY_CODE[t.code]!.division))]
        .map((d) => teams.filter((t) => TEAMS_BY_CODE[t.code]!.division === d).sort(byRecord)[0]!)
        .sort(byRecord);
      const rest = teams.filter((t) => !leaders.includes(t)).sort(byRecord);
      return [...leaders, ...rest].slice(0, 7);
    };
    const started = s.games.some((g) => g.phase === "REG" && g.played);
    return (
      <Card maxWidth={940}>
        <CardHeader badge={leagueBadge(s)} title="Postseason" subtitle={`${s.season} playoffs · not seeded yet`} />
        <div className="panel open">
          <div className="emptystate" style={{ marginBottom: started ? 20 : 0 }}>
            The bracket is seeded when the regular season ends
            {started ? " — here's how the field looks right now." : "."}
          </div>
          {started && single && (
            <div>
              <p className="subhead" style={{ marginTop: 0 }}>
                League — current top {playoffFieldSize(Object.keys(s.teams).length)}
              </p>
              <table className="stbl">
                <tbody>
                  {Object.values(s.teams)
                    .sort((x, y) => winPct(y) - winPct(x) || y.pointsFor - y.pointsAgainst - (x.pointsFor - x.pointsAgainst))
                    .map((t, i) => (
                      <tr
                        key={t.code}
                        className={t.code === code ? "highlight" : ""}
                        style={i >= playoffFieldSize(Object.keys(s.teams).length) ? { opacity: 0.55 } : undefined}
                      >
                        <td className="c" style={{ width: 22, color: "var(--ink-faint)" }}>{i + 1}</td>
                        <td className="name">{TEAMS_BY_CODE[t.code]!.label}</td>
                        <td className="r">{record(t)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {started && !single && (
            <div className="split-2" style={{ gap: 24 }}>
              {(["AFC", "NFC"] as const).map((conf) => (
                <div key={conf}>
                  <p className="subhead" style={{ marginTop: 0 }}>
                    {conf} — seeds if it ended today
                  </p>
                  <table className="stbl">
                    <tbody>
                      {inHunt(conf).map((t, i) => (
                        <tr key={t.code} className={t.code === code ? "highlight" : ""}>
                          <td className="c" style={{ width: 22, color: "var(--ink-faint)" }}>{i + 1}</td>
                          <td className="name">{TEAMS_BY_CODE[t.code]!.label}</td>
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
        {viewerTeamCode(s) && <ExpiringContracts teamCode={viewerTeamCode(s)!} />}
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

  const inField =
    code && (b.format === "single" ? (b.field ?? []).includes(code) : b.seeds.AFC.includes(code) || b.seeds.NFC.includes(code));
  const mySeed = !code
    ? 0
    : b.format === "single"
      ? (b.field ?? []).indexOf(code) + 1
      : ([...b.seeds.AFC, ...b.seeds.NFC].indexOf(code) % 7) + 1;
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
  const online = onlineSession() !== null;

  return (
    <Card maxWidth={960}>
      <CardHeader badge={leagueBadge(s)} title="Postseason" subtitle={`${roundLabelFor(b, b.currentRound)} · ${s.season} playoffs`} />
      <Ticker
        stats={[
          {
            label: "Your team",
            value: b.champion === code ? "Champion" : eliminated ? "Eliminated" : inField ? "Alive" : "Missed",
            className: "accent",
          },
          {
            label: "Seed",
            value: !inField
              ? "—"
              : b.format === "single"
                ? `${mySeed} of ${(b.field ?? []).length}`
                : `${mySeed} (${TEAMS_BY_CODE[code!]!.conference})`,
          },
          {
            label: "Next game",
            // the higher seed hosts; the Super Bowl is neutral. A 5 seed used
            // to read "vs Tampa Bay" for a game in Tampa
            value: myNextOpp
              ? `${myNext!.round !== "SB" && myNext!.highSeed?.code !== code ? "@" : "vs"} ${TEAMS_BY_CODE[myNextOpp]!.label}`
              : b.champion || eliminated || !inField
                ? "—"
                : // the round, at least: a top seed on a bye read "TBD" as if
                  // nothing was scheduled
                  myNext
                  ? (() => {
                      const rounds = bracketRounds(b);
                      const bye = !myNext.highSeed || !myNext.lowSeed;
                      const at = rounds.indexOf(myNext.round);
                      const round = bye && at >= 0 && at + 1 < rounds.length ? rounds[at + 1]! : myNext.round;
                      return `${roundLabelFor(b, round)} · opponent TBD`;
                    })()
                  : "TBD",
            className: "sm",
          },
          { label: "Champion", value: b.champion ? TEAMS_BY_CODE[b.champion]!.label : "—", className: "sm" },
        ]}
      />
      {b.format === "single" ? (
        <>
          <Tabs
            tabs={[
              { id: "bracket", label: "Bracket" },
              { id: "matchup", label: "Matchup" },
            ]}
            active={active}
            onChange={setActive}
          />
          {active === "matchup" ? (
            <div className="panel open">
              <PostseasonMatchups b={b} />
            </div>
          ) : (
            <SingleBracket b={b} me={code} />
          )}
        </>
      ) : (
      <>
      <Tabs
        tabs={[
          { id: "afc", label: "AFC" },
          { id: "nfc", label: "NFC" },
          { id: "sb", label: "Super Bowl" },
          { id: "matchup", label: "Matchup" },
        ]}
        active={active}
        onChange={setActive}
      />

      {(["afc", "nfc"] as const).map((conf) => (
        <Panel key={conf} open={active === conf}>
          <ConferenceBracket conf={conf.toUpperCase() as "AFC" | "NFC"} matchups={b.matchups} me={code} />
        </Panel>
      ))}

      <Panel id="matchup" open={active === "matchup"}>
        <PostseasonMatchups b={b} />
      </Panel>

      <Panel id="sb" open={active === "sb"}>
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
      </>
      )}

      {viewerTeamCode(s) && <ExpiringContracts teamCode={viewerTeamCode(s)!} />}
      <Footer>
        {/*
          Change 11: the team hub and the roster come off the postseason.
          There is nothing left to manage — the bracket was decided before
          anyone saw it — and a roster screen here would be a control that
          cannot affect anything it appears to be about.
        */}
        <button type="button" className="btnlink" onClick={() => nav("/player-stats")}>
          Player Statistics
        </button>
        <button type="button" className="btnlink" onClick={() => nav("/league-stats")}>
          League Statistics
        </button>
      </Footer>

      {isPlayoffStage && !online && s.pendingGameDay && (
        // a round has been played but not "continued" from Game Day yet (this
        // is also how the Super Bowl result is left after it sims) — offer
        // the way forward instead of the gate, which would sim again
        <div className="readiness">
          <div className="readiness-top">
            <p>{b.champion ? `The ${roundLabelFor(b, "SB")} has been played` : `${roundLabelFor(b, s.pendingGameDay.phase as PlayoffRound)} results are in`}</p>
            <span>Continue from Game Day to move on</span>
          </div>
          <button type="button" className="btn-primary" style={{ width: "100%" }} onClick={() => nav("/game-day")}>
            {b.champion ? "See the final result" : "View round results"}
          </button>
        </div>
      )}
      {isPlayoffStage && online && <RoundReveal />}
      {isPlayoffStage && !online && !s.pendingGameDay && !b.champion && <GamePlanStrip />}
      {isPlayoffStage && !online && !s.pendingGameDay && !b.champion && (
        <ReadinessGate
          title={`${roundLabelFor(b, b.currentRound)} readiness`}
          label={`Simulate the ${roundLabelFor(b, b.currentRound)}`}
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
        // on a phone the rounds stack into one column, and an elbow from a
        // box's right edge to the "next column" cut back across the boxes
        if (s.length === 0 || d.l <= s[0]!.r) return;
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
      <div className="split-3" style={{ gap: 40 }}>
        {(["WC", "DIV", "CONF"] as const).map((round, ci) => (
          <div key={round}>
            <p className="subhead" style={{ textAlign: "center", marginTop: 0 }}>
              {roundLabelFor(null, round)}
            </p>
            <div
              ref={ci === 0 ? wc : ci === 1 ? div : cc}
              className="bracket-col"
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
  const teams = useStore((st) => st.teams);
  const gms = useStore((st) => st.gms);
  const gmOf = (code: string) => gms.find((g) => g.isHuman && g.teamCode === code);
  const yours = m.highSeed?.code === me || m.lowSeed?.code === me;
  const played = m.homeScore != null && m.awayScore != null;
  const bye = m.round === "WC" && !m.lowSeed;

  const row = (side: BracketMatchup["highSeed"], score: number | null, isWinner: boolean) => {
    if (!side) return <div style={{ padding: "9px 12px", color: "var(--ink-faint)", fontStyle: "italic", fontSize: 13 }}>TBD</div>;
    const t = TEAMS_BY_CODE[side.code]!;
    const st = teams[side.code];
    const gm = gmOf(side.code);
    const mineSide = side.code === me;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "9px 12px",
          gap: 8,
          background: isWinner ? "rgba(111,200,150,0.07)" : undefined,
          // a GM's team stands out from thirty others; yours most of all
          ...(gm ? { boxShadow: `inset 3px 0 0 ${mineSide ? "var(--team)" : "var(--notice)"}` } : {}),
          ...(mineSide ? { background: "color-mix(in srgb, var(--team) 14%, transparent)" } : {}),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span className="oswald" style={{ width: 20, height: 20, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: t.color, color: onColorFor(t.color) }}>
            {side.seed || "•"}
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: gm ? 700 : 500 }}>{t.label}</span>
            {gm && (
              <span className="ppos" style={{ marginLeft: 6 }}>
                {mineSide ? "you" : gm.name}
              </span>
            )}
            <GmLine code={side.code} style={{ display: "block", fontSize: 10.5 }} />
            {st && (
              <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)" }}>
                {st.ratings.overall} OVR · {st.wins}-{st.losses}
                {st.ties ? `-${st.ties}` : ""}
              </span>
            )}
          </span>
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
            : `${TEAMS_BY_CODE[favCode]!.label} favored · ${favProb}%`}
        </div>
      )}
    </div>
  );
}

export { ordinal };

/**
 * Simulate Playoff Round, which is a reveal.
 *
 * One round, and no reveal-all. Everything is already played and saved, so
 * this only moves this GM's marker — and it keeps moving after their team is
 * out, because a GM knocked out in the wild card is still in the league and
 * still wants to see who wins it.
 */
function RoundReveal() {
  const s = useStore();
  const nav = useNavigate();
  const actions = useLeagueActions();
  const [busy, setBusy] = useState(false);
  // a refused or dropped press used to look like a button that did nothing
  const [error, setError] = useState<string | null>(null);
  const errorLine = error && (
    <p className="form-error" role="status" style={{ margin: "8px 0 0" }}>
      {error}
    </p>
  );

  const seen = revealedRounds(s, s.viewerGmId);
  const rounds = s.bracket ? bracketRounds(s.bracket) : [];
  const next = rounds.find((r) => !seen.includes(r)) as PlayoffRound | undefined;
  // rounds are played one checkpoint at a time; one this GM hasn't watched may not exist yet
  const played = s.bracket?.roundsPlayed ?? rounds.length;
  const nextPlayed = !!next && rounds.indexOf(next) < played;
  const myTeam = s.gms.find((g) => g.id === s.viewerGmId)?.teamCode;
  const imReady = !!s.readiness[s.viewerGmId];
  const waitingOn = s.gms.filter((g) => g.isHuman && g.teamCode && !s.readiness[g.id] && g.id !== s.viewerGmId).map((g) => g.name);
  // still alive: in the round after everything played so far, with no loss on the board
  const alive =
    !!myTeam &&
    !(s.bracket?.matchups ?? []).some(
      (m) => m.winner != null && m.winner !== myTeam && (m.highSeed?.code === myTeam || m.lowSeed?.code === myTeam),
    ) &&
    (s.bracket?.seeds.AFC.includes(myTeam) || s.bracket?.seeds.NFC.includes(myTeam) || !!s.bracket?.field?.includes(myTeam));

  if (!next) {
    return (
      <div className="readiness">
        <div className="readiness-top">
          <p>The postseason is over</p>
          <span>You&rsquo;ve watched every round</span>
        </div>
        <button
          className="btn-primary"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void actions
              .readyUp(true)
              .then((res) => {
                if (!res.ok) setError(res.reason ?? "Couldn't reach the league. Try again.");
                // to the waiting page — or the next stage, if this was the last check-in
                else nav("/");
              })
              .finally(() => setBusy(false));
          }}
        >
          Advance to the Offseason
        </button>
        {errorLine}
      </div>
    );
  }

  if (!nextPlayed) {
    // the next round is a checkpoint: plans for it, then everybody checks in
    return (
      <div className="readiness">
        <div className="readiness-top">
          <p>{roundLabelFor(s.bracket, next)}</p>
          <span aria-live="polite">
            {imReady ? (waitingOn.length ? `Waiting on ${waitingOn.join(", ")}` : "Playing the round…") : "Not played yet"}
          </span>
        </div>
        {alive ? (
          <>
            <p className="readiness-held">
              Your next game is in the {roundLabelFor(s.bracket, next)}. Set your game plan for this opponent, then check in: the
              round is played once every GM still alive has.
            </p>
            <GamePlanStrip />
            <button
              className="btn-primary"
              style={{ width: "100%" }}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                void actions
                  .readyUp(!imReady)
                  .then((res) => {
                    if (!res.ok) setError(res.reason ?? "Couldn't reach the league. Try again.");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "…" : imReady ? "Change my plan (un-check in)" : `Ready for the ${roundLabelFor(s.bracket, next)}`}
            </button>
          </>
        ) : (
          <p className="readiness-held">
            Your season is over. The {roundLabelFor(s.bracket, next)} is played once the GMs still alive have set their plans;
            you can watch it then.
          </p>
        )}
        {errorLine}
      </div>
    );
  }

  return (
    <div className="readiness">
      <div className="readiness-top">
        <p>{roundLabelFor(s.bracket, next)}</p>
        <span aria-live="polite">
          {seen.length} of {rounds.length} {rounds.length === 1 ? "round" : "rounds"} watched
        </span>
      </div>
      <p className="readiness-held">
        Watch one round at a time, at your own pace.
      </p>
      <button
        className="btn-primary"
        style={{ width: "100%" }}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void actions
            .revealRound()
            .then((res) => {
              if (res.ok) nav(`/results/round/${next}`);
              else setError(res.reason ?? "Couldn't reveal that round. Try again.");
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "…" : `Watch the ${roundLabelFor(s.bracket, next)}`}
      </button>
      {errorLine}
    </div>
  );
}

/**
 * A humans-only league's bracket: one field, rounds as columns, best seed
 * against worst in each. No conferences, so no tabs.
 */
function SingleBracket({ b, me }: { b: import("@/domain").BracketState; me: string | undefined }) {
  const rounds = bracketRounds(b);
  return (
    <div className="panel open">
      <div className="single-bracket" style={{ "--rounds": rounds.length } as React.CSSProperties}>
        {rounds.map((round) => {
          const games = b.matchups.filter((m) => m.round === round);
          return (
            <div key={round}>
              <p className="subhead" style={{ marginTop: 0, textAlign: "center" }}>
                {roundLabelFor(b, round)}
              </p>
              <div style={{ display: "grid", gap: 14 }}>
                {games.map((m, i) => (
                  <MatchBox key={i} m={m} me={me} />
                ))}
                {games.length === 0 && <div className="emptystate">Set once the previous round is played.</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
