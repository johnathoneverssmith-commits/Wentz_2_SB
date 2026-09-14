/**
 * The live field visualisation — a native React view.
 *
 * This was previously a sandboxed iframe carrying a standalone HTML/JS build
 * of the same thing. That kept its timers and document-level listeners from
 * leaking into the app, but it also meant it could never share the app's
 * theme: it rendered as a light "broadcast" panel in the middle of a dark
 * page and never picked up the controlled team's colour. Ported here, the
 * telestrator accent *is* `--team`, so the chalk, the arrows and the
 * transport wear whichever franchise you're running.
 *
 * The two things the iframe was protecting are handled directly instead: the
 * playback timer lives in an effect and is cleaned up on unmount, and the
 * keyboard shortcuts are bound to this subtree rather than to `document`, so
 * space and the arrow keys only do something while the Gamecast has focus.
 *
 * Geometry, arrow shapes and the drive/step model are a faithful port of the
 * original — see `segPath` and `buildSteps`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import type { BroadcastDrive, BroadcastPlay, GameResult, InjuryEvent } from "@/domain";

import "./gamecast.css";

/* ---- geometry (unchanged from the original) ---- */
const OWN = 100;
const TARGET = 900;
const U = (TARGET - OWN) / 100; // 8 units per yard
const EZ = 80;
const TOP = 50;
const BOT = 450;
const LANE = 250;

const xLR = (ballOn: number): number => OWN + (100 - Math.max(0, Math.min(100, ballOn))) * U;
const clampX = (x: number): number => Math.max(OWN - EZ + 10, Math.min(TARGET + EZ - 10, x));

/** Teams switch ends every quarter; home attacks left→right in odd quarters. */
const homeAttacksRight = (q: number): boolean => q % 2 === 1;
const driveAttacksRight = (side: string, q: number): boolean =>
  (side === "home") === homeAttacksRight(q);

const teamColor = (code: string): string => TEAMS_BY_CODE[code]?.color ?? "var(--ink-faint)";
const teamNick = (code: string): string => (TEAMS_BY_CODE[code]?.name ?? code).toUpperCase();

const spot = (ballOn: number): string => {
  if (Math.abs(ballOn - 50) < 0.5) return "midfield";
  const y = Math.round(ballOn > 50 ? 100 - ballOn : ballOn);
  return `${ballOn > 50 ? "own" : "opp"} ${y}`;
};
const ord = (n: number): string => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

/* ---- step model: one pre-snap beat per drive, then one beat per play ---- */
type Step =
  | { type: "presnap"; k: number; quarter: number }
  | { type: "play"; k: number; j: number; p: BroadcastPlay; quarter: number };

function buildSteps(drives: BroadcastDrive[]): { steps: Step[]; driveStart: number[] } {
  const steps: Step[] = [];
  const driveStart: number[] = [];
  drives.forEach((d, k) => {
    driveStart[k] = steps.length;
    steps.push({ type: "presnap", k, quarter: d.quarter });
    d.plays.forEach((p, j) => steps.push({ type: "play", k, j, p, quarter: p.quarter }));
  });
  return { steps, driveStart };
}

type Interstitial =
  | { kind: "quarter"; quarter: number }
  | { kind: "injury"; event: InjuryEvent };

/* ---- narrated play description, with the player names spliced in ---- */
function PlayDesc({ p }: { p: BroadcastPlay }): JSX.Element {
  const N = ({ n }: { n: string | undefined }) =>
    n ? <span className="gc-name">{n}</span> : <></>;
  const g = Math.round(p.gained);
  const to = p.touchdown ? "the end zone" : `the ${spot(Math.max(1, p.ballOn - p.gained))}`;

  if (p.call === "field_goal") {
    return (
      <>
        <N n={p.kicker} /> {p.distance}-yard field goal{" "}
        {p.outcome === "made" ? "is GOOD" : "attempt is NO GOOD"}
      </>
    );
  }
  if (p.call === "punt") {
    if (p.outcome === "touchback")
      return (<><N n={p.kicker} /> punts {p.distance} yards, touchback</>);
    if (p.outcome === "return_td")
      return (<><N n={p.kicker} /> punts {p.distance} yards — returned by <N n={p.returner} /> for a TOUCHDOWN</>);
    if (p.outcome === "downed")
      return (<><N n={p.kicker} /> punts {p.distance} yards, downed</>);
    return (<><N n={p.kicker} /> punts {p.distance} yards, returned by <N n={p.returner} /></>);
  }

  let body: JSX.Element;
  if (p.call === "sack") body = (<><N n={p.passer} /> sacked for {g} to {to}</>);
  else if (p.call === "scramble")
    body = (<><N n={p.passer} /> scrambles for {g >= 0 ? "+" : ""}{g} to {to}</>);
  else if (p.call === "run")
    body = (<><N n={p.targetOrRusher} /> run for {g >= 0 ? "+" : ""}{g} to {to}</>);
  else if (p.outcome === "interception")
    body = (<><N n={p.passer} /> pass intercepted by <N n={p.defender} /></>);
  else if (g === 0 && !p.touchdown)
    body = (<><N n={p.passer} /> incomplete for <N n={p.targetOrRusher} /> ({p.depth.toLowerCase().replace(/_/g, " ")})</>);
  else body = (<><N n={p.passer} /> complete to <N n={p.targetOrRusher} /> for {g} to {to}</>);

  return (
    <>
      {body}
      {p.outcome === "fumble" && <> — fumble, forced by <N n={p.defender} /></>}
      {p.touchdown ? (
        <> — TOUCHDOWN</>
      ) : p.firstDown ? (
        <> (1st down)</>
      ) : p.turnover && p.call !== "sack" && p.outcome !== "interception" && p.outcome !== "fumble" ? (
        <> — TURNOVER</>
      ) : null}
    </>
  );
}

/* ---- one play's arrow ---- */
const DEPTH_PX: Record<string, number> = {
  BEHIND_LOS: 20,
  SHORT: 60,
  INTERMEDIATE: 110,
  DEEP: 170,
  "": 45,
};
type Seg = { d: string; end: [number, number]; kind: string };

function segPath(p: BroadcastPlay, Xf: (b: number) => number, atkRight: boolean): Seg {
  const x0 = clampX(Xf(p.ballOn));
  const x1 = clampX(Xf(p.ballOn - p.gained));
  if (p.call === "field_goal") {
    const postX = atkRight ? TARGET + EZ - 14 : OWN - EZ + 14;
    const mx = (x0 + postX) / 2;
    return {
      d: `M ${x0} ${LANE} Q ${mx} 128 ${postX} 150`,
      end: [postX, 150],
      kind: p.outcome === "made" ? "fg-good" : "fg-no",
    };
  }
  if (p.call === "punt") {
    const mx = (x0 + x1) / 2;
    const h = Math.min(175, 75 + Math.abs(p.gained) * 1.7);
    return { d: `M ${x0} ${LANE} Q ${mx} ${LANE - h} ${x1} ${LANE}`, end: [x1, LANE], kind: "punt" };
  }
  const pass = p.call === "pass";
  const incomplete = pass && p.gained === 0 && !p.touchdown && p.outcome !== "interception";
  const picked = p.outcome === "interception";
  if (incomplete || picked) {
    const reach = (DEPTH_PX[p.depth] ?? 60) * (atkRight ? 1 : -1);
    const tx = clampX(x0 + reach);
    return {
      d: `M ${x0} ${LANE} Q ${(x0 + tx) / 2} ${LANE - Math.abs(reach) * 1.1} ${tx} ${LANE}`,
      end: [(x0 + tx) / 2, LANE - Math.abs(reach) * 0.7],
      kind: picked ? "int" : "inc",
    };
  }
  if (pass) {
    const mx = (x0 + x1) / 2;
    const h = Math.min(150, 44 + Math.abs(p.gained) * 3.2);
    return { d: `M ${x0} ${LANE} Q ${mx} ${LANE - h} ${x1} ${LANE}`, end: [x1, LANE], kind: "pass" };
  }
  return { d: `M ${x0} ${LANE} L ${x1} ${LANE}`, end: [x1, LANE], kind: "run" };
}

/* ---- static field paint ---- */
const YARD_NUMBERS: Array<[number, string]> = [
  [10, "10"], [20, "20"], [30, "30"], [40, "40"], [50, "50"],
  [60, "40"], [70, "30"], [80, "20"], [90, "10"],
];

function GoalPost({ x }: { x: number }): JSX.Element {
  return (
    <g>
      <ellipse cx={x} cy={LANE + 4} rx={12} ry={4} fill="#000" opacity={0.22} />
      <path d={`M ${x} ${LANE} L ${x} 172`} stroke="#000" strokeOpacity={0.16} strokeWidth={9} strokeLinecap="round" />
      <g fill="none" stroke="#ffc324" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <path d={`M ${x} ${LANE} L ${x} 172 Q ${x} 158 ${x - 18} 158 L ${x - 32} 158 L ${x - 32} 84`} />
        <path d={`M ${x} 172 Q ${x} 158 ${x + 18} 158 L ${x + 32} 158 L ${x + 32} 84`} />
      </g>
      <circle cx={x - 32} cy={82} r={3} fill="#ffc324" />
      <circle cx={x + 32} cy={82} r={3} fill="#ffc324" />
    </g>
  );
}

function StaticField(): JSX.Element {
  const fives: number[] = [];
  for (let m = 0; m <= 100; m += 5) fives.push(m);
  const hashes: number[] = [];
  for (let m = 1; m < 100; m++) if (m % 5 !== 0) hashes.push(m);
  return (
    <>
      <rect x={0} y={TOP} width={1000} height={BOT - TOP} fill="var(--gc-turf)" />
      {fives.map((m) => {
        const x = OWN + m * U;
        const major = m % 10 === 0;
        return (
          <line key={`f${m}`} x1={x} y1={TOP} x2={x} y2={BOT} stroke="var(--gc-turf-line)"
            strokeOpacity={major ? 0.8 : 0.4} strokeWidth={major ? 2 : 1} />
        );
      })}
      {[OWN, TARGET].map((x) => (
        <line key={`g${x}`} x1={x} y1={TOP} x2={x} y2={BOT} stroke="var(--gc-turf-line)" strokeWidth={3} />
      ))}
      <rect x={OWN - EZ} y={TOP} width={TARGET + EZ - (OWN - EZ)} height={BOT - TOP}
        fill="none" stroke="var(--gc-turf-line)" strokeWidth={3} />
      {[180, 320].map((y) =>
        hashes.map((m) => {
          const x = OWN + m * U;
          return (
            <line key={`h${y}-${m}`} x1={x} y1={y - 5} x2={x} y2={y + 5}
              stroke="var(--gc-turf-line)" strokeOpacity={0.45} strokeWidth={1} />
          );
        }),
      )}
      {YARD_NUMBERS.map(([m, label]) => {
        const x = OWN + m * U;
        return (
          <g key={`n${m}`}>
            <text x={x} y={108} textAnchor="middle" className="gc-figure" fontWeight={600}
              fontSize={32} letterSpacing={3} fill="var(--gc-turf-line)" fillOpacity={0.62}>{label}</text>
            <text x={x} y={402} textAnchor="middle" className="gc-figure" fontWeight={600}
              fontSize={32} letterSpacing={3} fill="var(--gc-turf-line)" fillOpacity={0.62}
              transform={`rotate(180 ${x} 396)`}>{label}</text>
          </g>
        );
      })}
      <GoalPost x={OWN - EZ} />
      <GoalPost x={TARGET + EZ} />
    </>
  );
}

function Ball({ x, y, team, glow }: { x: number; y: number; team: string; glow: boolean }): JSX.Element {
  return (
    <>
      <g transform={`translate(${x} ${y})`} filter={glow ? "url(#gc-glow)" : undefined}>
        <ellipse rx={27} ry={17.5} fill="none" stroke={teamColor(team)} strokeWidth={4} />
        <ellipse rx={21.5} ry={13.5} fill="#7a3c14" stroke="#2b1405" strokeWidth={2.2} />
        <line x1={-9.5} y1={0} x2={9.5} y2={0} stroke="#f4ead9" strokeWidth={2.6} />
        <line x1={-5.2} y1={-4.2} x2={-5.2} y2={4.2} stroke="#f4ead9" strokeWidth={2.1} />
        <line x1={0} y1={-4.8} x2={0} y2={4.8} stroke="#f4ead9" strokeWidth={2.1} />
        <line x1={5.2} y1={-4.2} x2={5.2} y2={4.2} stroke="#f4ead9" strokeWidth={2.1} />
      </g>
      <g transform={`translate(${x} ${y - 36})`}>
        <rect x={-24} y={-14} width={48} height={25} rx={6} fill={teamColor(team)} />
        <text textAnchor="middle" y={5} className="gc-figure" fontWeight={700} fontSize={16}
          letterSpacing={0.5} fill="#fff">{team}</text>
      </g>
    </>
  );
}

const SEG_LABEL: Record<string, string> = {
  int: "INTERCEPTED",
  inc: "incomplete",
  "fg-good": "GOOD",
  "fg-no": "NO GOOD",
};

const ICON = {
  prev: "M13 4 5 12l8 8V4z M4 4h2v16H4z",
  next: "M7 4l8 8-8 8V4z M18 4h2v16h-2z",
  play: "M6 4l14 8-14 8V4z",
  pause: "M6 4h4v16H6z M14 4h4v16h-4z",
};

export function Gamecast({ game }: { game: GameResult }): JSX.Element | null {
  const bc = game.broadcast;
  const drives = useMemo(() => bc?.drives ?? [], [bc]);
  const { steps, driveStart } = useMemo(() => buildSteps(drives), [drives]);
  const total = steps.length;

  const [gi, setGi] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [lastQuarter, setLastQuarter] = useState(steps[0]?.quarter ?? 1);
  const [pending, setPending] = useState<Interstitial[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const step = steps[gi - 1];
  const drive = step ? drives[step.k] : undefined;

  /** advance one beat, queueing the quarter/injury interstitials it reveals */
  const advance = useCallback(() => {
    if (gi >= total) return;
    const next = gi + 1;
    const st = steps[next - 1]!;
    const queued: Interstitial[] = [];
    if (st.quarter > lastQuarter) {
      queued.push({ kind: "quarter", quarter: st.quarter });
      setLastQuarter(st.quarter);
    }
    if (st.type === "play" && st.p.injuries.length) {
      for (const e of st.p.injuries) queued.push({ kind: "injury", event: e });
    }
    setGi(next);
    if (queued.length) setPending((q) => [...q, ...queued]);
  }, [gi, total, steps, lastQuarter]);

  /** random access (drive click, scrub): jump, no interstitials */
  const jumpTo = useCallback(
    (target: number) => {
      const t = Math.max(1, Math.min(total, target));
      setPlaying(false);
      setPending([]);
      setGi(t);
      setLastQuarter(steps[t - 1]?.quarter ?? 1);
    },
    [total, steps],
  );

  // playback clock — paused while an interstitial is up, cleaned up on unmount
  useEffect(() => {
    if (!playing || pending.length > 0) return;
    if (gi >= total) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(advance, 1100 / speed);
    return () => clearTimeout(t);
  }, [playing, pending.length, gi, total, speed, advance]);

  const stepOnce = useCallback(
    (delta: number) => {
      setPlaying(false);
      if (delta < 0) setGi((g) => Math.max(1, g - 1));
      else advance();
    },
    [advance],
  );

  const dismiss = useCallback(() => setPending((q) => q.slice(1)), []);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (gi >= total) jumpTo(1);
    setPlaying(true);
  }, [playing, gi, total, jumpTo]);

  // injuries reveal progressively — no spoilers ahead of the replay
  const revealed = useMemo(() => {
    const out: InjuryEvent[] = [];
    for (let s = 0; s < gi; s++) {
      const st = steps[s];
      if (st?.type === "play" && st.p.injuries.length) out.push(...st.p.injuries);
    }
    return out;
  }, [gi, steps]);

  if (!bc || !step || !drive) return null;

  const atkRight = driveAttacksRight(drive.side, drive.quarter);
  const Xf = (ballOn: number): number => (atkRight ? xLR(ballOn) : 1000 - xLR(ballOn));
  const dTeam = drive.team;
  const defTeam = dTeam === bc.home ? bc.away : bc.home;

  const playsShown = gi - (driveStart[step.k] ?? 0) - 1;
  const shown = drive.plays.slice(0, playsShown);
  const cur = step.type === "play" ? step.p : null;
  const next = playsShown < drive.plays.length ? drive.plays[playsShown] : null;
  const ballOn = cur ? (cur.touchdown ? 0 : Math.max(0, cur.ballOn - cur.gained)) : drive.startBallOn;
  const turnedOver =
    cur && (cur.outcome === "interception" || cur.outcome === "fumble" || cur.call === "punt");
  const driveEnded = cur && (cur.touchdown || cur.call === "punt" || cur.call === "field_goal");
  const possessor = turnedOver ? defTeam : dTeam;
  const targetEZx = atkRight ? TARGET + EZ / 2 : OWN - EZ / 2;
  const postX = atkRight ? TARGET + EZ - 14 : OWN - EZ + 14;
  const fgGood = !!cur && cur.call === "field_goal" && cur.outcome === "made";
  const scored = (!!cur && cur.touchdown) || fgGood;
  let bx = cur && cur.touchdown ? targetEZx : clampX(Xf(ballOn));
  let by = LANE;
  if (cur && cur.call === "field_goal") {
    bx = postX;
    by = 150;
  }

  const marker = next ?? cur;

  /**
   * The scoreboard as of where the replay has reached.
   *
   * This used to read `bc.finalScore`, which meant the board showed the final
   * from the opening kickoff — a replay that tells you the answer before it
   * starts, sat next to an injury panel that carefully reveals itself play by
   * play. The score after a play is on the play itself, so this is the last
   * one the viewer has seen.
   *
   * A league saved before the running score existed has no `scoreAfter`; for
   * those the board falls back to the final rather than sitting on 0-0.
   */
  const liveScore = ((): readonly [number, number] => {
    for (let i = gi - 1; i >= 0; i--) {
      const st = steps[i];
      if (st?.type !== "play") continue;
      return st.p.scoreAfter ?? bc.finalScore;
    }
    return steps.some((st) => st.type === "play" && st.p.scoreAfter) ? [0, 0] : bc.finalScore;
  })();
  const [hs, as] = liveScore;
  const done = gi >= total;
  const it = pending[0];

  return (
    <div
      className="gc"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement).matches("input,select")) return;
        if (it) {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            dismiss();
          }
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          stepOnce(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          stepOnce(-1);
        } else if (e.key === " ") {
          e.preventDefault();
          togglePlay();
        }
      }}
    >
      {/* scoreboard */}
      <div className="gc-board">
        <div className="gc-side" style={{ ["--gc-tc" as string]: teamColor(bc.away) }}>
          <span className="gc-chip" />
          <span className="gc-code">{bc.away}</span>
          <span className="gc-score">{as}</span>
        </div>
        <div className="gc-mid">
          <span className={`gc-status${done ? "" : " live"}`}>
            {done ? "Final" : gi <= 1 ? "Pre-game" : `Q${step.quarter}`}
          </span>
          <span className="gc-situ">
            Q{drive.quarter} · {step.type === "play" ? cur!.clock : drive.startClock}
          </span>
        </div>
        <div className="gc-side home" style={{ ["--gc-tc" as string]: teamColor(bc.home) }}>
          <span className="gc-chip" />
          <span className="gc-code">{bc.home}</span>
          <span className="gc-score">{hs}</span>
        </div>
      </div>

      <div className="gc-grid">
        {/* drive chart */}
        <section className="gc-panel">
          <div className="gc-phead">
            <span>Drive Chart</span>
            <span className="n">{drives.length} drives</span>
          </div>
          <div className="gc-drives">
            {drives.map((dr, k) => {
              // what the possession itself did
              const tag =
                dr.ended === "touchdown"
                  ? { cls: "td", label: "TD" }
                  : dr.ended === "field_goal"
                    ? { cls: "td", label: "FG" }
                    : dr.ended === "missed_field_goal"
                      ? { cls: "to", label: "MISS" }
                      : dr.ended === "punt" || dr.ended === "punt_return_td"
                        ? { cls: "special", label: "PUNT" }
                        : dr.ended === "turnover"
                          ? { cls: "to", label: "TO" }
                          : null;
              // and what it cost — a punt taken back or a pick-six used to
              // show as a plain PUNT or TO with the seven points nowhere
              const conceded =
                dr.pointsAgainst >= 6
                  ? dr.ended === "punt_return_td"
                    ? "RET TD"
                    : "DEF TD"
                  : dr.pointsAgainst === 2
                    ? "SAFETY"
                    : null;
              return (
                <button
                  key={k}
                  className="gc-drive"
                  aria-current={k === step.k}
                  style={{ ["--gc-tc" as string]: teamColor(dr.team) }}
                  onClick={() => jumpTo((driveStart[k] ?? 0) + 1)}
                >
                  <span className="gc-dteam">{dr.team}</span>
                  <span className="gc-dwhen">
                    Q{dr.quarter} {dr.startClock}
                  </span>
                  <span className="gc-dmeta">
                    {dr.plays.length} plays · from the {spot(dr.startBallOn)}
                    {tag && <span className={`gc-dtag ${tag.cls}`}>{tag.label}</span>}
                    {conceded && <span className="gc-dtag against">{conceded}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* field */}
        <section className="gc-panel gc-stage">
          <div className="gc-fieldwrap">
            <svg
              className="gc-field"
              viewBox="0 0 1000 500"
              role="img"
              aria-label="football field with the ball tracked play by play"
            >
              <defs>
                <marker id="gc-ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4"
                  orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill="var(--gc-chalk)" />
                </marker>
                <filter id="gc-glow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="5" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              <StaticField />

              {/* end zones, tinted to whoever defends them */}
              <rect x={OWN - EZ} y={TOP} width={EZ} height={BOT - TOP}
                fill={`color-mix(in srgb, ${teamColor(atkRight ? defTeam : dTeam)} ${!atkRight && scored ? 60 : 42}%, var(--gc-turf-2))`} />
              <rect x={TARGET} y={TOP} width={EZ} height={BOT - TOP}
                fill={`color-mix(in srgb, ${teamColor(atkRight ? dTeam : defTeam)} ${atkRight && scored ? 60 : 42}%, var(--gc-turf-2))`} />
              {([[OWN - EZ / 2, atkRight ? defTeam : dTeam], [TARGET + EZ / 2, atkRight ? dTeam : defTeam]] as const).map(
                ([x, team]) => (
                  <text key={`ez${x}`} x={x} y={(TOP + BOT) / 2} textAnchor="middle"
                    transform={`rotate(-90 ${x} ${(TOP + BOT) / 2})`} className="gc-figure"
                    fontWeight={700} fontSize={29} letterSpacing={4} fill="var(--gc-turf-ink)" fillOpacity={0.92}>
                    {teamNick(team)}
                  </text>
                ),
              )}

              {/* who's driving, and which way */}
              <text x={atkRight ? OWN + 10 : TARGET - 10} y={TOP - 22}
                textAnchor={atkRight ? "start" : "end"} className="gc-figure" fontWeight={600}
                fontSize={15} letterSpacing={1.5} fill="var(--ink-dim)">
                {atkRight ? `${dTeam} driving ▶` : `◀ ${dTeam} driving`}
              </text>

              {/* line of scrimmage + first-down marker */}
              {marker && !driveEnded && (
                <>
                  <line x1={clampX(Xf(marker.ballOn))} y1={TOP + 4} x2={clampX(Xf(marker.ballOn))} y2={BOT - 4}
                    stroke="var(--gc-los)" strokeWidth={2.5} strokeDasharray="2 5" />
                  {marker.ballOn - marker.ydstogo > 0 && (
                    <line x1={clampX(Xf(marker.ballOn - marker.ydstogo))} y1={TOP + 4}
                      x2={clampX(Xf(marker.ballOn - marker.ydstogo))} y2={BOT - 4}
                      stroke="var(--gc-first)" strokeWidth={2.5} />
                  )}
                </>
              )}

              {/* one arrow per revealed play; the last one is the live call */}
              {shown.map((p, j) => {
                const seg = segPath(p, Xf, atkRight);
                const last = j === shown.length - 1;
                const stroke =
                  seg.kind === "int" || seg.kind === "fg-no"
                    ? "var(--gc-injury)"
                    : seg.kind === "punt"
                      ? "var(--gc-special)"
                      : "var(--gc-chalk)";
                const dash =
                  seg.kind === "inc" ? "6 7"
                    : seg.kind === "int" ? "8 7"
                      : seg.kind === "punt" ? "4 9"
                        : seg.kind === "fg-good" || seg.kind === "fg-no" ? "3 8"
                          : undefined;
                const head = last && (seg.kind === "run" || seg.kind === "pass" || seg.kind === "punt");
                return (
                  <g key={j}>
                    <path d={seg.d} fill="none" stroke={stroke} strokeLinecap="round"
                      strokeWidth={last ? 7 : 3.2} strokeOpacity={last ? 1 : 0.32} strokeDasharray={dash}
                      markerEnd={head ? "url(#gc-ah)" : undefined} />
                    {last && SEG_LABEL[seg.kind] && (
                      <text x={seg.end[0]} y={seg.end[1] - 12} textAnchor="middle" fontWeight={600}
                        fontSize={19} fill={stroke}>{SEG_LABEL[seg.kind]}</text>
                    )}
                    {last && seg.kind === "punt" && (
                      <text x={seg.end[0]} y={LANE - Math.min(175, 75 + Math.abs(p.gained) * 1.7) - 10}
                        textAnchor="middle" fontWeight={600} fontSize={17} fill="var(--gc-special)">PUNT</text>
                    )}
                  </g>
                );
              })}

              <Ball x={bx} y={by} team={possessor} glow={scored} />
            </svg>
          </div>

          <div className="gc-playline">
            <span className={`gc-dd${scored ? " td" : ""}`}>
              {!cur
                ? "1st & 10"
                : cur.touchdown
                  ? "Touchdown"
                  : cur.call === "field_goal"
                    ? cur.outcome === "made" ? "Field Goal" : "No Good"
                    : cur.call === "punt"
                      ? "Punt"
                      : `${ord(cur.down)} & ${Math.round(cur.ydstogo) || "Goal"} at the ${spot(cur.ballOn)}`}
            </span>
            <span className="gc-desc">
              {cur ? <PlayDesc p={cur} /> : `${dTeam} takes over at the ${spot(next?.ballOn ?? drive.startBallOn)}`}
            </span>
          </div>

          <div className="gc-transport">
            <button onClick={() => stepOnce(-1)} disabled={gi <= 1} aria-label="previous step">
              <svg viewBox="0 0 24 24"><path d={ICON.prev} /></svg>
            </button>
            <button className="gc-play" onClick={togglePlay} aria-label={playing ? "pause" : "play"}>
              <svg viewBox="0 0 24 24"><path d={playing ? ICON.pause : ICON.play} /></svg>
            </button>
            <button onClick={() => stepOnce(1)} disabled={gi >= total} aria-label="next step">
              <svg viewBox="0 0 24 24"><path d={ICON.next} /></svg>
            </button>
            <div className="gc-scrub">
              <input type="range" min={1} max={total} value={gi} aria-label="game position"
                onChange={(e) => jumpTo(Number(e.target.value))} />
              <span className="gc-count">{gi} / {total}</span>
            </div>
            <select value={speed} aria-label="playback speed" onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
            <button className="gc-skip" disabled={gi >= total} onClick={() => jumpTo(total)}>
              Skip to final
            </button>
          </div>

          {it && (
            <div className="gc-veil">
              <div
                className="gc-card"
                style={{ ["--gc-accent" as string]: it.kind === "injury" ? "var(--gc-injury)" : "var(--gc-chalk)" }}
              >
                {it.kind === "quarter" ? (
                  <>
                    <p className="gc-kicker">Now starting</p>
                    <h2>Quarter {it.quarter}</h2>
                    <p className="gc-sub">
                      {bc.away} at {bc.home} · teams switch ends of the field
                    </p>
                  </>
                ) : (
                  <>
                    <p className="gc-kicker">
                      {it.event.team} injury · Q{it.event.quarter} {it.event.clock}
                    </p>
                    <h2>{it.event.player}</h2>
                    <p className="gc-sub">{it.event.position} · out for the rest of the game</p>
                    <p className="gc-narr">{it.event.narrative}</p>
                    <span className="gc-wk">
                      Projected:{" "}
                      {it.event.severity === "season"
                        ? "out for the season"
                        : it.event.projectedWeeks[0] === it.event.projectedWeeks[1]
                          ? `${it.event.projectedWeeks[0]} week${it.event.projectedWeeks[0] === 1 ? "" : "s"}`
                          : `${it.event.projectedWeeks[0]}–${it.event.projectedWeeks[1]} weeks`}
                    </span>
                  </>
                )}
                <button className="btn-primary" style={{ width: "100%", marginTop: 14 }} autoFocus onClick={dismiss}>
                  Continue
                </button>
              </div>
            </div>
          )}
        </section>

        {/* injury report */}
        <section className="gc-panel">
          <div className="gc-phead">
            <span>Injury Report</span>
            <span className="n">{revealed.length ? `${revealed.length} so far` : ""}</span>
          </div>
          <div className="gc-injuries">
            {revealed.length === 0 ? (
              <div className="gc-empty">No injuries yet — the report fills in live as the game plays out.</div>
            ) : (
              [...revealed].reverse().map((e, i) => {
                const [lo, hi] = e.projectedWeeks;
                return (
                  <div className="gc-inj" key={i}>
                    <span className="gc-stripe" />
                    <div>
                      <div className="gc-injtop">
                        <span className="gc-who" style={{ borderLeft: `3px solid ${teamColor(e.team)}` }}>
                          {e.player}
                        </span>
                        <span className="gc-injtag">
                          {e.team} · Q{e.quarter} {e.clock}
                        </span>
                      </div>
                      <div className="gc-injbody">{e.narrative}</div>
                      <span className="gc-wk">
                        {e.severity === "season" ? "out for the year" : lo === hi ? `${lo} wk` : `${lo}–${hi} wk`}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      <p className="gc-foot">
        Ball position, drive arrows, attribution and injuries all come from the engine's opt-in per-play trace —
        nothing here perturbs the sim.
      </p>
    </div>
  );
}
