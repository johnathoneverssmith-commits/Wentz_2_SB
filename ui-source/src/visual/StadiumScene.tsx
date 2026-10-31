import { useId, useMemo, type ReactNode } from "react";
import { deepen, TEAMS_BY_CODE } from "@/data/teams";
import { hash32 } from "@/sim/leagueDna/streams";
import { atmospherePalette, type AtmospherePalette } from "./atmosphere";
import { specFor, type Landmark, type StadiumSpec } from "./stadiumSpec";
import "./visual.css";

const W = 1600;
const H = 520;
const GROUND = 430;

function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hexToRgb = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
function mixHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

interface Colors {
  primary: string;
  accent: string;
  /** dark facade tone, readable against any sky */
  facade: string;
  /** silhouette tone: a heavy mix of the sky into near-black so it reads in both heaven and hell */
  sil: string;
}

function colorsFor(team: string | undefined, p: AtmospherePalette): Colors {
  const meta = team ? TEAMS_BY_CODE[team] : undefined;
  const primary = meta?.color ?? "#3a5f86";
  const accent = meta?.accent ?? (primary === "#000000" ? "#A5ACAF" : mixHex(primary, "#ffffff", 0.45));
  const facade = mixHex(deepen(primary === "#000000" ? "#2a2f36" : primary, 0.5), "#0a1520", 0.35);
  // in daylight the skyline is a hazy blue-grey; at night / in fire it is near black
  const sil = mixHex("#050a12", "#5d7898", Math.min(1, p.daylight * 0.9));
  return { primary, accent, facade, sil };
}

/* ───────────── landmarks: simple, recognisable silhouettes on a ground line ───────────── */
function landmark(kind: Landmark, x: number, y: number, s: number, c: Colors): ReactNode {
  const f = c.sil;
  const k = (n: number) => n * s;
  switch (kind) {
    case "needle":
      return <g><path d={`M${x - k(5)} ${y} L${x - k(2)} ${y - k(105)} L${x + k(2)} ${y - k(105)} L${x + k(5)} ${y}Z`} fill={f}/><ellipse cx={x} cy={y - k(112)} rx={k(30)} ry={k(7)} fill={f}/><rect x={x - k(1.5)} y={y - k(140)} width={k(3)} height={k(30)} fill={f}/></g>;
    case "suspension":
      return <g stroke={f} fill="none" strokeWidth={k(2.2)}><path d={`M${x - k(120)} ${y - k(10)} L${x + k(120)} ${y - k(10)}`}/><path d={`M${x - k(60)} ${y - k(10)} V${y - k(75)} M${x + k(60)} ${y - k(10)} V${y - k(75)}`} strokeWidth={k(5)}/><path d={`M${x - k(120)} ${y - k(14)} Q${x - k(90)} ${y - k(14)} ${x - k(60)} ${y - k(75)} Q${x} ${y - k(10)} ${x + k(60)} ${y - k(75)} Q${x + k(90)} ${y - k(14)} ${x + k(120)} ${y - k(14)}`}/></g>;
    case "truss":
      return <g stroke={f} fill="none" strokeWidth={k(2)}><path d={`M${x - k(110)} ${y - k(8)} H${x + k(110)}`}/><path d={`M${x - k(100)} ${y - k(8)} Q${x} ${y - k(70)} ${x + k(100)} ${y - k(8)}`}/>{[-70, -35, 0, 35, 70].map((o) => <path key={o} d={`M${x + k(o)} ${y - k(8)} V${y - k(8 + 44 * (1 - Math.abs(o) / 110))}`} />)}</g>;
    case "spire":
      return <g fill={f}><rect x={x - k(14)} y={y - k(90)} width={k(28)} height={k(90)}/><path d={`M${x - k(14)} ${y - k(90)} L${x} ${y - k(150)} L${x + k(14)} ${y - k(90)}Z`}/></g>;
    case "orb":
      return <g fill={f}><rect x={x - k(2.5)} y={y - k(95)} width={k(5)} height={k(95)}/><circle cx={x} cy={y - k(105)} r={k(17)}/></g>;
    case "clocktower":
      return <g fill={f}><rect x={x - k(13)} y={y - k(100)} width={k(26)} height={k(100)}/><path d={`M${x - k(17)} ${y - k(100)} L${x} ${y - k(128)} L${x + k(17)} ${y - k(100)}Z`}/><circle cx={x} cy={y - k(80)} r={k(7)} fill={mixHex(f, "#ffffff", 0.7)} opacity=".8"/></g>;
    case "lighthouse":
      return <g fill={f}><path d={`M${x - k(11)} ${y} L${x - k(6)} ${y - k(80)} L${x + k(6)} ${y - k(80)} L${x + k(11)} ${y}Z`}/><rect x={x - k(9)} y={y - k(92)} width={k(18)} height={k(12)}/><path d={`M${x - k(11)} ${y - k(92)} L${x} ${y - k(108)} L${x + k(11)} ${y - k(92)}Z`}/></g>;
    case "silos":
      return <g fill={f}>{[0, 1, 2, 3].map((i) => <g key={i}><rect x={x + k(i * 26 - 52)} y={y - k(60)} width={k(22)} height={k(60)}/><ellipse cx={x + k(i * 26 - 41)} cy={y - k(60)} rx={k(11)} ry={k(5)}/></g>)}<rect x={x - k(56)} y={y - k(70)} width={k(114)} height={k(8)}/></g>;
    case "rig":
      return <g stroke={f} fill="none" strokeWidth={k(2)}><path d={`M${x - k(24)} ${y} L${x} ${y - k(95)} L${x + k(24)} ${y}Z`}/><path d={`M${x - k(16)} ${y - k(35)} H${x + k(16)} M${x - k(9)} ${y - k(65)} H${x + k(9)}`}/></g>;
    case "obelisk":
      return <g fill={f}><path d={`M${x - k(9)} ${y} L${x - k(5)} ${y - k(105)} L${x} ${y - k(122)} L${x + k(5)} ${y - k(105)} L${x + k(9)} ${y}Z`}/><rect x={x - k(22)} y={y - k(8)} width={k(44)} height={k(8)}/></g>;
    case "palms":
      return <g stroke={f} fill={f} strokeWidth={k(3)}>{[-36, 0, 34].map((o, i) => { const h = 62 + (i % 2) * 20; return <g key={o}><path d={`M${x + k(o)} ${y} Q${x + k(o + 6)} ${y - k(h / 2)} ${x + k(o + 2)} ${y - k(h)}`} fill="none"/>{[-60, -20, 20, 60, 100, 140].map((a) => <path key={a} d={`M${x + k(o + 2)} ${y - k(h)} q${k(28 * Math.cos((a * Math.PI) / 180))} ${k(-18 * Math.sin((a * Math.PI) / 180) + 8)} ${k(40 * Math.cos((a * Math.PI) / 180))} ${k(14)}`} fill="none" strokeWidth={k(2.4)}/>)}</g>; })}</g>;
    case "mountains":
      return <g fill={f}><path d={`M${x - k(170)} ${y} L${x - k(90)} ${y - k(90)} L${x - k(55)} ${y - k(60)} L${x + k(10)} ${y - k(130)} L${x + k(70)} ${y - k(55)} L${x + k(110)} ${y - k(85)} L${x + k(180)} ${y}Z`}/><path d={`M${x + k(10)} ${y - k(130)} l${k(-14)} ${k(22)} l${k(10)} ${k(-5)} l${k(8)} ${k(10)} l${k(8)} ${k(-12)}Z`} fill="#ffffff" opacity=".55"/></g>;
    case "liberty":
      return <g fill={f}><path d={`M${x - k(14)} ${y} L${x - k(10)} ${y - k(40)} H${x + k(10)} L${x + k(14)} ${y}Z`}/><rect x={x - k(5)} y={y - k(85)} width={k(10)} height={k(45)}/><circle cx={x} cy={y - k(90)} r={k(7)}/><path d={`M${x - k(8)} ${y - k(94)} l${k(-6)} ${k(-12)} M${x} ${y - k(97)} v${k(-14)} M${x + k(8)} ${y - k(94)} l${k(6)} ${k(-12)}`} stroke={f} strokeWidth={k(2.4)} fill="none"/><path d={`M${x + k(5)} ${y - k(78)} l${k(14)} ${k(-26)}`} stroke={f} strokeWidth={k(3)}/></g>;
    case "fountain":
      return <g fill="none" stroke={f} strokeWidth={k(2.6)}><path d={`M${x - k(50)} ${y - k(6)} H${x + k(50)}`}/>{[-30, -12, 0, 12, 30].map((o) => <path key={o} d={`M${x + k(o)} ${y - k(6)} q${k(o * 0.2)} ${k(-50 + Math.abs(o))} ${k(o * 0.5)} ${k(-62 + Math.abs(o))}`}/>)}</g>;
    case "casino":
      return <g fill={f}><rect x={x - k(10)} y={y - k(125)} width={k(20)} height={k(125)}/><path d={`M${x - k(40)} ${y} V${y - k(60)} H${x - k(10)} V${y}Z M${x + k(10)} ${y} V${y - k(80)} H${x + k(44)} V${y}Z`}/><rect x={x - k(2)} y={y - k(150)} width={k(4)} height={k(26)}/></g>;
    case "wheel":
      return <g stroke={f} fill="none" strokeWidth={k(2)}><circle cx={x} cy={y - k(55)} r={k(50)}/><circle cx={x} cy={y - k(55)} r={k(4)} fill={f}/>{Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${x} ${y - k(55)} L${x + k(50) * Math.cos((i * Math.PI) / 6)} ${y - k(55) + k(50) * Math.sin((i * Math.PI) / 6)}`} strokeWidth={k(1)}/>)}<path d={`M${x - k(22)} ${y} L${x} ${y - k(55)} L${x + k(22)} ${y}`}/></g>;
    case "sails":
      return <g fill={f}>{[-28, 0, 28].map((o, i) => <path key={o} d={`M${x + k(o)} ${y - k(8)} L${x + k(o)} ${y - k(70 - i * 8)} Q${x + k(o + 22)} ${y - k(40)} ${x + k(o + 20)} ${y - k(8)}Z`}/>)}<rect x={x - k(40)} y={y - k(8)} width={k(80)} height={k(5)}/></g>;
    case "hills":
      return <g fill={f}><path d={`M${x - k(200)} ${y} Q${x - k(120)} ${y - k(80)} ${x - k(40)} ${y - k(30)} Q${x + k(40)} ${y - k(100)} ${x + k(130)} ${y - k(25)} Q${x + k(170)} ${y - k(45)} ${x + k(210)} ${y}Z`}/></g>;
    case "colonnade":
      return <g fill={f}><rect x={x - k(60)} y={y - k(10)} width={k(120)} height={k(10)}/>{Array.from({ length: 7 }, (_, i) => <rect key={i} x={x - k(56) + i * k(17)} y={y - k(52)} width={k(7)} height={k(42)}/>)}<rect x={x - k(64)} y={y - k(62)} width={k(128)} height={k(10)}/></g>;
    case "barn":
      return <g fill={f}><path d={`M${x - k(32)} ${y} V${y - k(34)} L${x - k(20)} ${y - k(52)} H${x + k(20)} L${x + k(32)} ${y - k(34)} V${y}Z`}/><rect x={x + k(42)} y={y - k(78)} width={k(16)} height={k(78)}/><ellipse cx={x + k(50)} cy={y - k(78)} rx={k(8)} ry={k(5)}/></g>;
    case "pines":
      return <g fill={f}>{[-50, -26, 0, 26, 52].map((o, i) => <path key={o} d={`M${x + k(o - 14)} ${y} L${x + k(o)} ${y - k(60 + (i % 2) * 18)} L${x + k(o + 14)} ${y}Z`}/>)}</g>;
    case "steamboat":
      return <g fill={f}><path d={`M${x - k(60)} ${y} L${x - k(48)} ${y - k(16)} H${x + k(52)} L${x + k(66)} ${y}Z`}/><rect x={x - k(34)} y={y - k(34)} width={k(60)} height={k(18)}/><rect x={x - k(26)} y={y - k(60)} width={k(7)} height={k(26)}/><rect x={x - k(8)} y={y - k(64)} width={k(7)} height={k(30)}/><circle cx={x - k(52)} cy={y - k(10)} r={k(12)} opacity=".7"/></g>;
    case "capitol":
      return <g fill={f}><rect x={x - k(70)} y={y - k(30)} width={k(140)} height={k(30)}/><rect x={x - k(24)} y={y - k(52)} width={k(48)} height={k(22)}/><path d={`M${x - k(22)} ${y - k(52)} Q${x} ${y - k(104)} ${x + k(22)} ${y - k(52)}Z`}/><rect x={x - k(2)} y={y - k(124)} width={k(4)} height={k(22)}/></g>;
    case "cityhall":
      return <g fill={f}><rect x={x - k(48)} y={y - k(52)} width={k(96)} height={k(52)}/><rect x={x - k(16)} y={y - k(110)} width={k(32)} height={k(58)}/><path d={`M${x - k(16)} ${y - k(110)} L${x} ${y - k(138)} L${x + k(16)} ${y - k(110)}Z`}/></g>;
    case "mesa":
      return <g fill={f}><path d={`M${x - k(150)} ${y} L${x - k(120)} ${y - k(55)} H${x - k(30)} L${x} ${y - k(10)} L${x + k(20)} ${y - k(70)} H${x + k(100)} L${x + k(140)} ${y}Z`}/></g>;
    case "saguaro":
      return <g stroke={f} fill="none" strokeWidth={k(7)} strokeLinecap="round">{[0, 70].map((o, i) => <g key={o}><path d={`M${x + k(o)} ${y} V${y - k(70 - i * 14)}`}/><path d={`M${x + k(o)} ${y - k(28)} h${k(-16)} v${k(-22)}`} strokeWidth={k(5)}/><path d={`M${x + k(o)} ${y - k(38)} h${k(14)} v${k(-18)}`} strokeWidth={k(5)}/></g>)}</g>;
    case "cranes":
      return <g stroke={f} fill="none" strokeWidth={k(2.4)}>{[0, 56].map((o, i) => <g key={o}><path d={`M${x + k(o)} ${y} V${y - k(78)} M${x + k(o - 40)} ${y - k(78)} H${x + k(o + 36)} M${x + k(o - 32)} ${y - k(78)} L${x + k(o - 32)} ${y - k(60 - i * 6)}`}/></g>)}</g>;
  }
}

function skyline(team: string | undefined, spec: StadiumSpec, c: Colors, p: AtmospherePalette): ReactNode {
  const r = rngOf(hash32("skyline", team ?? "neutral"));
  const n = Math.round(14 + spec.density * 34);
  const out: ReactNode[] = [];
  const glow = p.daylight < 0.45;
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const w = 22 + r() * 40;
    const tall = spec.density * (60 + r() * 180) + 16;
    const near = Math.abs(x - W * spec.anchor) < 330;
    const h = near ? tall * 0.45 : tall; // keep the stadium's neighbourhood low so it reads
    out.push(<rect key={i} x={x} y={GROUND - h} width={w} height={h} fill={c.sil} opacity={0.5 + r() * 0.4}/>);
    if (glow && h > 50) {
      const rows = Math.min(7, Math.floor(h / 16));
      for (let j = 0; j < rows; j++) if (r() > 0.5) out.push(<rect key={`${i}w${j}`} x={x + 4 + r() * (w - 12)} y={GROUND - h + 8 + j * 14} width={3} height={4} fill={p.fire > 0.3 ? "#ff9a4a" : "#ffe9a8"} opacity={0.5 * (1 - p.daylight)}/>);
    }
  }
  return <g>{out}</g>;
}

function terrain(spec: StadiumSpec, c: Colors, p: AtmospherePalette): ReactNode {
  const sea = mixHex(p.horizon, "#0b1a2a", 0.55);
  switch (spec.terrain) {
    case "water":
      return <g><rect x="0" y={GROUND - 4} width={W} height="30" fill={sea} opacity=".85"/><path d={`M0 ${GROUND + 6} q100 -8 200 0 t200 0 t200 0 t200 0 t200 0 t200 0 t200 0 t200 0`} stroke={p.glow} strokeOpacity=".28" fill="none"/></g>;
    case "mountains":
      return <path d={`M0 ${GROUND} L180 ${GROUND - 110} L300 ${GROUND - 50} L470 ${GROUND - 160} L640 ${GROUND - 40} L1040 ${GROUND - 60} L1220 ${GROUND - 170} L1400 ${GROUND - 70} L1600 ${GROUND - 120} V${GROUND}Z`} fill={mixHex(c.sil, p.horizon, 0.18)} opacity=".8"/>;
    case "hills":
      return <path d={`M0 ${GROUND} Q200 ${GROUND - 90} 420 ${GROUND - 30} T900 ${GROUND - 40} T1600 ${GROUND - 70} V${GROUND}Z`} fill={mixHex(c.sil, p.horizon, 0.12)} opacity=".85"/>;
    case "desert":
      return <path d={`M0 ${GROUND} Q300 ${GROUND - 40} 700 ${GROUND - 12} T1600 ${GROUND - 36} V${GROUND}Z`} fill={mixHex(c.sil, "#a0623a", 0.25 * (0.3 + p.daylight))} opacity=".8"/>;
    default:
      return null;
  }
}

/* ───────────── the stadium itself ───────────── */
function stadium(spec: StadiumSpec, c: Colors, p: AtmospherePalette): ReactNode {
  const cx = W * spec.anchor;
  const w = 560;
  const top = GROUND - (spec.tiers === 3 ? 150 : 118);
  const L = cx - w / 2;
  const R = cx + w / 2;
  const lit = mixHex(c.accent, "#ffffff", 0.35);
  const tierH = (GROUND - top) / spec.tiers;
  const bowl: ReactNode[] = [];
  for (let i = 0; i < spec.tiers; i++) {
    const y = top + i * tierH;
    const inset = (spec.tiers - i - 1) * 14;
    bowl.push(<path key={i} d={`M${L + inset} ${y + tierH} L${L + inset + 18} ${y} H${R - inset - 18} L${R - inset} ${y + tierH}Z`} fill={mixHex(c.facade, "#000000", i * 0.12)} stroke={c.primary} strokeOpacity=".5" strokeWidth="1.5"/>);
  }
  const roof: ReactNode = (() => {
    switch (spec.roof) {
      case "dome":
        return <path d={`M${L + 10} ${top + 6} Q${cx} ${top - 120} ${R - 10} ${top + 6}Z`} fill={mixHex(c.facade, "#9fb2c8", 0.25)} stroke={c.accent} strokeOpacity=".6"/>;
      case "canopy":
        return <path d={`M${L - 16} ${top + 14} L${L + 30} ${top - 14} H${R - 30} L${R + 16} ${top + 14}Z`} fill={mixHex(c.facade, "#cfd8e3", 0.18)} stroke={c.accent} strokeOpacity=".7"/>;
      case "oculus":
        return <g><path d={`M${L - 8} ${top + 12} L${L + 40} ${top - 22} H${cx - 80} L${cx - 40} ${top + 8}Z M${R + 8} ${top + 12} L${R - 40} ${top - 22} H${cx + 80} L${cx + 40} ${top + 8}Z`} fill={mixHex(c.facade, "#cfd8e3", 0.2)} stroke={c.accent} strokeOpacity=".7"/><ellipse cx={cx} cy={top - 6} rx="70" ry="12" fill="none" stroke={lit} strokeWidth="2" opacity=".8"/></g>;
      case "arch":
        return <g fill="none" stroke={lit} strokeWidth="6" opacity=".9"><path d={`M${L - 10} ${GROUND} Q${cx} ${top - 150} ${R + 10} ${GROUND}`}/><path d={`M${L + 40} ${GROUND} Q${cx} ${top - 100} ${R - 40} ${GROUND}`} strokeWidth="3" opacity=".6"/></g>;
      case "sail":
        return <path d={`M${L - 10} ${top + 12} Q${cx - 40} ${top - 80} ${R + 30} ${top - 26} L${R - 10} ${top + 14}Z`} fill={mixHex("#e8f1fb", c.primary, 0.2)} opacity=".8" stroke={c.accent} strokeOpacity=".6"/>;
      case "lattice":
        return <g stroke={lit} strokeWidth="2.4" fill="none" opacity=".85"><path d={`M${L} ${top + 4} H${R}`}/><path d={`M${L + 40} ${top - 38} H${R - 40}`}/>{Array.from({ length: 18 }, (_, i) => <path key={i} d={`M${L + 30 + i * 29} ${top + 4} L${L + 44 + i * 29} ${top - 38}`}/>)}</g>;
      case "ring":
        return <g fill="none"><ellipse cx={cx} cy={top - 10} rx={w / 2 + 14} ry="26" stroke={lit} strokeWidth="5" opacity=".9"/><ellipse cx={cx} cy={top - 10} rx={w / 2 + 14} ry="26" stroke={c.primary} strokeWidth="2" opacity=".9"/></g>;
      case "fins":
        return <g fill={mixHex(c.facade, "#0a0f15", 0.3)} stroke={c.accent} strokeOpacity=".6">{Array.from({ length: 12 }, (_, i) => <path key={i} d={`M${L + 10 + i * 46} ${top + 14} l12 -40 l12 40Z`}/>)}</g>;
      case "glass":
        return <path d={`M${L - 14} ${top + 14} Q${cx} ${top - 90} ${R + 14} ${top + 14}Z`} fill="#bfe0ff" opacity={0.18 + p.daylight * 0.2} stroke={lit} strokeOpacity=".7"/>;
      default:
        return <path d={`M${L - 6} ${top + 4} H${R + 6}`} stroke={c.accent} strokeOpacity=".7" strokeWidth="3"/>;
    }
  })();
  const tower = (x: number, k: number) => (
    <g key={k}>
      <rect x={x - 3} y={top - 78} width="6" height={GROUND - top + 78} fill={c.sil}/>
      <rect x={x - 22} y={top - 94} width="44" height="18" rx="2" fill="#0b121a" stroke={lit} strokeOpacity=".7"/>
      {[-15, -5, 5, 15].map((o) => <circle key={o} cx={x + o} cy={top - 85} r="3.4" fill="#fffbe8"/>)}
      <path d={`M${x - 20} ${top - 80} L${x - 180} ${GROUND} H${x + 140}Z`} fill="url(#beam)" opacity={0.18 + 0.25 * (1 - p.daylight)}/>
    </g>
  );
  return (
    <g>
      {tower(L - 70, 0)}
      {tower(R + 70, 1)}
      {bowl}
      {roof}
      {/* the team's colour as a band and as lit crest strip */}
      <rect x={L + 24} y={GROUND - 30} width={w - 48} height="9" fill={c.primary}/>
      <rect x={L + 24} y={GROUND - 21} width={w - 48} height="3" fill={lit} opacity=".8"/>
      {Array.from({ length: 22 }, (_, i) => <rect key={i} x={L + 44 + i * 22.5} y={top + 22} width="3" height="6" fill="#ffe9b0" opacity={0.2 + 0.5 * (1 - p.daylight)}/>)}
    </g>
  );
}

export interface StadiumSceneProps {
  team?: string;
  /** 0 infernal .. 1 heavenly; 0.5 neutral */
  level?: number;
  /** a stable id isn't needed by callers; used so several scenes can share a page */
  className?: string;
}

/**
 * The shared stadium scene: sky and weather from `level`, architecture,
 * landmarks and colours from `team`. Decorative; always aria-hidden.
 */
export function StadiumScene({ team, level = 0.5, className = "" }: StadiumSceneProps) {
  const uid = useId().replace(/:/g, "");
  const spec = specFor(team);
  const p = useMemo(() => atmospherePalette(level), [level]);
  const c = useMemo(() => colorsFor(team, p), [team, p]);
  const sky = useMemo(() => skyline(team, spec, c, p), [team, spec, c, p]);
  const embers = useMemo(() => {
    const r = rngOf(hash32("embers", team ?? "n"));
    return Array.from({ length: 26 }, (_, i) => ({ x: r() * W, y: GROUND - r() * 140, s: 1.4 + r() * 3, d: 4 + r() * 6, del: -r() * 8, key: i }));
  }, [team]);
  const rays = useMemo(() => {
    const r = rngOf(hash32("rays", team ?? "n"));
    return Array.from({ length: 7 }, (_, i) => ({ x: 120 + i * 230 + r() * 60, w: 60 + r() * 90, key: i, del: -r() * 6 }));
  }, [team]);
  const lm1 = spec.landmarks[0];
  const lm2 = spec.landmarks[1];
  const stX = W * spec.anchor;
  const lmLeftX = stX > W / 2 ? 230 : W - 250;
  const lmRightX = stX > W / 2 ? 520 : W - 540;
  const id = (n: string) => `${n}-${uid}`;
  return (
    <svg className={`stadium-scene ${className}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false" data-team={team ?? "neutral"}>
      <defs>
        <linearGradient id={id("sky")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={p.skyTop}/><stop offset=".55" stopColor={p.skyMid}/><stop offset="1" stopColor={p.horizon}/>
        </linearGradient>
        <radialGradient id={id("glow")} cx=".5" cy="1" r=".7">
          <stop offset="0" stopColor={p.glow} stopOpacity={0.4 + 0.5 * p.fire + 0.3 * p.rays}/><stop offset="1" stopColor={p.glow} stopOpacity="0"/>
        </radialGradient>
        <linearGradient id={id("ray")} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff8dc" stopOpacity=".85"/><stop offset="1" stopColor="#fff8dc" stopOpacity="0"/></linearGradient>
        <linearGradient id={id("fire")} x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#ff5a10" stopOpacity=".95"/><stop offset=".6" stopColor="#c21e0a" stopOpacity=".5"/><stop offset="1" stopColor="#3b0808" stopOpacity="0"/></linearGradient>
        <filter id={id("blur")} x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fffbe8" stopOpacity=".9"/><stop offset="1" stopColor="#fffbe8" stopOpacity="0"/></linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id("sky")})`}/>
      <rect width={W} height={H} fill={`url(#${id("glow")})`}/>
      {/* heaven: a high sun and light shafts */}
      {p.rays > 0.02 && (
        <g opacity={p.rays}>
          <circle cx={W * 0.72} cy="90" r="46" fill="#fffdf0" opacity=".9"/>
          <circle cx={W * 0.72} cy="90" r="120" fill="#fff6cf" opacity=".28"/>
          {rays.map((r) => <path key={r.key} className="sv-ray" style={{ animationDelay: `${r.del}s` }} d={`M${W * 0.72} 90 L${r.x - r.w / 2} ${GROUND} H${r.x + r.w / 2}Z`} fill={`url(#${id("ray")})`} opacity=".35"/>)}
        </g>
      )}
      {/* soft cloud banks, whitest in heaven, ash in hell */}
      <g opacity={0.25 + p.clouds * 0.5} filter={`url(#${id("blur")})`}>
        <ellipse cx="260" cy="150" rx="260" ry="34" fill={mixHex("#2a3340", "#ffffff", p.clouds)}/>
        <ellipse cx="900" cy="110" rx="320" ry="30" fill={mixHex("#2a3340", "#ffffff", p.clouds)}/>
        <ellipse cx="1360" cy="190" rx="240" ry="30" fill={mixHex("#2a3340", "#ffffff", p.clouds)}/>
      </g>
      {terrain(spec, c, p)}
      {sky}
      {landmark(lm1, lmLeftX, GROUND, 1.25, c)}
      {landmark(lm2, lmRightX, GROUND, 1.1, c)}
      {/* hell: the horizon burns */}
      {p.fire > 0.02 && (
        <g opacity={p.fire}>
          <rect y={GROUND - 170} width={W} height="190" fill={`url(#${id("fire")})`} className="sv-flicker"/>
          {Array.from({ length: 16 }, (_, i) => {
            const x = i * 104 + 20;
            const h = 70 + ((i * 53) % 90);
            return <path key={i} className="sv-flame" style={{ animationDelay: `${-(i % 5) * 0.4}s` }} d={`M${x} ${GROUND + 8} Q${x + 18} ${GROUND - h * 0.6} ${x + 30} ${GROUND - h} Q${x + 44} ${GROUND - h * 0.5} ${x + 60} ${GROUND + 8}Z`} fill="#ff6a1a" opacity=".55"/>;
          })}
        </g>
      )}
      {stadium(spec, c, p)}
      {/* field light and the end-zone colour */}
      <ellipse cx={W * spec.anchor} cy={GROUND + 6} rx="300" ry="14" fill={mixHex(c.primary, "#0a1520", 0.35)} opacity=".95"/>
      <rect x="0" y={GROUND + 4} width={W} height={H - GROUND} fill={mixHex("#07121b", c.primary, 0.12)}/>
      {/* smoke bank over the ground in hell */}
      {p.smoke > 0.02 && (
        <g opacity={p.smoke * 0.75} filter={`url(#${id("blur")})`}>
          <ellipse className="sv-smoke" cx="300" cy={GROUND - 20} rx="360" ry="46" fill="#1b0a0a"/>
          <ellipse className="sv-smoke b" cx="1000" cy={GROUND - 36} rx="420" ry="52" fill="#240c0a"/>
          <ellipse className="sv-smoke" cx="1500" cy={GROUND - 10} rx="300" ry="40" fill="#160808"/>
        </g>
      )}
      {p.embers > 0.02 && (
        <g opacity={p.embers}>
          {embers.map((e) => <circle key={e.key} className="sv-ember" cx={e.x} cy={e.y} r={e.s} fill={e.key % 3 ? "#ff8a2a" : "#ffd36b"} style={{ animationDuration: `${e.d}s`, animationDelay: `${e.del}s` }}/>)}
        </g>
      )}
      {/* heaven: motes of light */}
      {p.rays > 0.4 && (
        <g opacity={p.rays}>
          {embers.slice(0, 14).map((e) => <circle key={e.key} className="sv-mote" cx={e.x} cy={e.y - 120} r={e.s * 0.7} fill="#fffbe8" style={{ animationDuration: `${e.d + 2}s`, animationDelay: `${e.del}s` }}/>)}
        </g>
      )}
    </svg>
  );
}
