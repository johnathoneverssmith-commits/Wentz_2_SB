import { memo, useMemo } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";

import { BEARD_STYLES, EYE_COLOR, HAIR_COLOR, HAIR_STYLES, portraitFor, portraitKey, SKIN, type PortraitSpec } from "@/state/portrait";
import { useStore } from "@/state/store";

/**
 * The one portrait component. Its interface is deliberately small and stable:
 *
 *   <PlayerPortrait playerId="p_12" size={48} teamColor="#0B2265" teamOnColor="#fff" />
 *
 * The face depends only on `playerId` (and the league); `teamColor` /
 * `teamOnColor` paint the jersey, so a trade changes the uniform and nothing
 * else. Without colours it is neutral grey. It is an inline SVG (no network,
 * no image decode, ~2KB of markup), so a 53-man roster of them is cheap, and
 * it renders the same in any theme. It is an illustration, not a photograph.
 */
export interface PlayerPortraitProps {
  playerId: string;
  /** pixel width; height is 1.2x */
  size?: number;
  teamColor?: string | undefined;
  teamOnColor?: string | undefined;
  /** league id/seed; defaults to the current league's seed */
  leagueId?: string | number | undefined;
  /** accessible name; omit for a decorative portrait */
  label?: string | undefined;
  className?: string | undefined;
  rounded?: boolean | undefined;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, "0")).join("")}`;
}

const HAIR_PATH: Record<(typeof HAIR_STYLES)[number], (w: number) => string> = {
  buzz: (w) => `M${50 - w},40 Q50,14 ${50 + w},40 Q50,29 ${50 - w},40Z`,
  short: (w) => `M${50 - w - 2},44 Q${50 - w - 3},16 50,15 Q${50 + w + 3},16 ${50 + w + 2},44 Q${50 + w},30 50,28 Q${50 - w},30 ${50 - w - 2},44Z`,
  fade: (w) => `M${50 - w},38 Q50,12 ${50 + w},38 Q50,26 ${50 - w},38Z M${50 - w + 4},24 Q50,8 ${50 + w - 4},24 Q50,19 ${50 - w + 4},24Z`,
  curls: (w) => `M${50 - w - 4},42 Q${50 - w - 8},14 50,12 Q${50 + w + 8},14 ${50 + w + 4},42 Q${50 + w},26 50,25 Q${50 - w},26 ${50 - w - 4},42Z`,
  waves: (w) => `M${50 - w - 3},46 Q${50 - w - 4},14 50,14 Q${50 + w + 4},14 ${50 + w + 3},46 Q${50 + w},28 62,27 Q50,22 38,27 Q${50 - w},28 ${50 - w - 3},46Z`,
  long: (w) => `M${50 - w - 4},70 Q${50 - w - 8},12 50,12 Q${50 + w + 8},12 ${50 + w + 4},70 Q${50 + w + 2},36 ${50 + w - 2},30 Q50,22 ${50 - w + 2},30 Q${50 - w - 2},36 ${50 - w - 4},70Z`,
  bald: () => "",
  afro: (w) => `M${50 - w - 8},40 Q${50 - w - 14},4 50,4 Q${50 + w + 14},4 ${50 + w + 8},40 Q${50 + w},24 50,23 Q${50 - w},24 ${50 - w - 8},40Z`,
  topknot: (w) => `M${50 - w},36 Q50,16 ${50 + w},36 Q50,26 ${50 - w},36Z M44,18 Q50,4 56,18 Q50,14 44,18Z`,
  crop: (w) => `M${50 - w - 1},40 Q${50 - w - 2},18 50,17 Q${50 + w + 2},18 ${50 + w + 1},40 Q${50 + w},31 50,30 Q${50 - w},31 ${50 - w - 1},40Z`,
};

function Face({ s, teamColor, teamOnColor }: { s: PortraitSpec; teamColor: string; teamOnColor: string }): JSX.Element {
  const skin = shade(SKIN[s.skin]!, s.skinShade * 0.03);
  const skinDark = shade(skin, -0.12);
  const hairC = HAIR_COLOR[s.hairColor]!;
  const eyeC = EYE_COLOR[s.eyeColor]!;
  const w = 17 + s.faceW * 5; // half cheek width
  const jawW = w - 3 - s.jawW * 5 + (s.jaw === 4 ? 3 : 0);
  const chinY = 74 + (s.jaw === 1 ? 2 : s.jaw === 2 ? -1 : 0);
  const neckW = 11 + s.neck * 6;
  const ex = 8 + s.eyeSpacing * 3;
  const hair = HAIR_STYLES[s.hair]!;
  const beard = BEARD_STYLES[s.beard]!;
  const hairPath = HAIR_PATH[hair](w);
  const browY = 47.5 - (s.brow === 1 ? 1 : 0);
  const browW = 1 + s.browThick * 1.6;

  const chin = s.jaw === 3 ? `Q50,${chinY + 6} ${50 - jawW * 0.4},${chinY}` : `Q50,${chinY + 3} ${50 - jawW * 0.5},${chinY - 1}`;
  const head = `M${50 - w},44 Q${50 - w},34 50,33 Q${50 + w},34 ${50 + w},44 L${50 + jawW},64 Q${50 + jawW * 0.8},${chinY} 50,${chinY + 3} Q${50 - jawW * 0.8},${chinY} ${50 - jawW},64Z`;
  void chin;

  return (
    <g>
      {/* jersey + neck */}
      <path d={`M10,125 Q12,92 36,86 L64,86 Q88,92 90,125Z`} fill={teamColor} />
      <path d={`M38,86 Q50,98 62,86 L58,84 Q50,92 42,84Z`} fill={teamOnColor} opacity={0.9} />
      <path d={`M${50 - neckW},70 L${50 - neckW - 1},88 Q50,98 ${50 + neckW + 1},88 L${50 + neckW},70Z`} fill={skinDark} />
      {hair === "long" && hairPath && <path d={hairPath} fill={hairC} transform="translate(0,0)" />}
      {/* ears */}
      <ellipse cx={50 - w - 0.5} cy={52} rx={2.4 + s.earSize * 1.6} ry={4 + s.earSize * 1.6} fill={skinDark} />
      <ellipse cx={50 + w + 0.5} cy={52} rx={2.4 + s.earSize * 1.6} ry={4 + s.earSize * 1.6} fill={skinDark} />
      <path d={head} fill={skin} />
      {/* beard under features */}
      {beard === "stubble" && <path d={`M${50 - jawW},58 Q50,${chinY + 8} ${50 + jawW},58 Q50,${chinY + 1} ${50 - jawW},58Z`} fill={hairC} opacity={0.22} />}
      {(beard === "short" || beard === "full") && (
        <path d={`M${50 - jawW - 1},56 Q${50 - jawW},${chinY + (beard === "full" ? 10 : 6)} 50,${chinY + (beard === "full" ? 11 : 7)} Q${50 + jawW},${chinY + (beard === "full" ? 10 : 6)} ${50 + jawW + 1},56 Q50,${beard === "full" ? 62 : 64} ${50 - jawW - 1},56Z`} fill={hairC} opacity={0.92} />
      )}
      {beard === "goatee" && <path d={`M44,${chinY - 8} Q50,${chinY - 4} 56,${chinY - 8} L55,${chinY + 4} Q50,${chinY + 8} 45,${chinY + 4}Z`} fill={hairC} />}
      {/* brows */}
      <path d={`M${50 - ex - 4},${browY} Q${50 - ex},${browY - 1.5 - (s.brow === 2 ? 1.5 : 0)} ${50 - ex + 4},${browY + (s.brow === 3 ? -1 : 0.5)}`} stroke={hairC} strokeWidth={browW} fill="none" strokeLinecap="round" />
      <path d={`M${50 + ex - 4},${browY + (s.brow === 3 ? -1 : 0.5)} Q${50 + ex},${browY - 1.5 - (s.brow === 2 ? 1.5 : 0)} ${50 + ex + 4},${browY}`} stroke={hairC} strokeWidth={browW} fill="none" strokeLinecap="round" />
      {/* eyes */}
      {s.eyeBlack && (
        <>
          <rect x={50 - ex - 4} y={53} width={8} height={1.9} rx={0.9} fill="#111" opacity={0.8} />
          <rect x={50 + ex - 4} y={53} width={8} height={1.9} rx={0.9} fill="#111" opacity={0.8} />
        </>
      )}
      <ellipse cx={50 - ex} cy={51} rx={3.2} ry={2.1} fill="#fff" />
      <ellipse cx={50 + ex} cy={51} rx={3.2} ry={2.1} fill="#fff" />
      <circle cx={50 - ex} cy={51} r={1.6} fill={eyeC} />
      <circle cx={50 + ex} cy={51} r={1.6} fill={eyeC} />
      {/* nose + mouth */}
      <path d={`M50,52 L${48.6 - s.noseW},60 Q50,62 ${51.4 + s.noseW},60`} stroke={skinDark} strokeWidth={1.1} fill="none" strokeLinecap="round" />
      {beard === "mustache" && <path d={`M${50 - 5 - s.mouthW * 2},64.5 Q50,61.5 ${50 + 5 + s.mouthW * 2},64.5 Q50,66.5 ${50 - 5 - s.mouthW * 2},64.5Z`} fill={hairC} />}
      <path d={`M${50 - 3 - s.mouthW * 2.5},67.5 Q50,${69.5} ${50 + 3 + s.mouthW * 2.5},67.5`} stroke={shade(skin, -0.32)} strokeWidth={1.3} fill="none" strokeLinecap="round" />
      {s.scar >= 0 && <path d={`M${58 + s.scar * 3},${42 + s.scar * 6} l-3,6`} stroke={shade(skin, -0.2)} strokeWidth={0.9} strokeLinecap="round" />}
      {/* hair over forehead */}
      {hair !== "long" && hair !== "bald" && <path d={hairPath} fill={hairC} fillRule="evenodd" />}
      {hair === "long" && <path d={`M${50 - w - 1},44 Q50,20 ${50 + w + 1},44 Q50,32 ${50 - w - 1},44Z`} fill={hairC} />}
      {s.headband >= 0 && <rect x={50 - w - 1} y={37} width={2 * w + 2} height={4} rx={1.5} fill={s.headband === 0 ? teamOnColor : s.headband === 1 ? "#f2f2f2" : "#222"} opacity={0.95} />}
    </g>
  );
}

export const PlayerPortrait = memo(function PlayerPortrait({ playerId, size = 48, teamColor = "#5d6672", teamOnColor = "#ffffff", leagueId, label, className, rounded = true }: PlayerPortraitProps): JSX.Element {
  const fallbackLeague = useStore((s) => s.seed ?? 0);
  const league = leagueId ?? fallbackLeague;
  const spec = useMemo(() => portraitFor(playerId, league), [playerId, league]);
  const bg = shade(teamColor, 0.18);
  return (
    <svg
      className={`player-portrait${className ? ` ${className}` : ""}`}
      width={size}
      height={Math.round(size * 1.2)}
      viewBox="0 0 100 120"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ borderRadius: rounded ? 10 : 0, background: `linear-gradient(160deg, ${bg}, ${shade(teamColor, -0.15)})`, flex: "none", display: "block" }}
      data-portrait={portraitKey(playerId)}
    >
      <Face s={spec} teamColor={teamColor} teamOnColor={teamOnColor} />
    </svg>
  );
});

/**
 * A portrait for a `Player`, dressed in his current team's colours. The
 * convenience most screens want: `<PlayerThumb player={p} />`. Pass `className`
 * to take over sizing from CSS (e.g. the roster's `.player-thumb` slot).
 */
export function PlayerThumb({ player, size = 40, className }: { player: { id: string; name: string; nfl_team: string }; size?: number; className?: string }): JSX.Element {
  const team = TEAMS_BY_CODE[player.nfl_team];
  return (
    <PlayerPortrait
      playerId={player.id}
      size={size}
      teamColor={team?.color}
      teamOnColor={team?.onColor}
      className={className}
    />
  );
}
