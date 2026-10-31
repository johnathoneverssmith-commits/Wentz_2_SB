import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useStore } from "@/state/store";
import { atmosphereLevel } from "@/state/humanRank";
import { StadiumScene } from "./StadiumScene";
import { useHumanRanking } from "./RankChip";

/** Screens that already carry their own stadium header and stay as designed. */
const OWN_BACKGROUND = new Set(["/roster"]);

/**
 * The shell-level stadium band. One component, mounted once in AppShell, so
 * every screen shares the viewer's stadium and standings atmosphere without
 * being rebuilt. Rank is among HUMAN GMs only; with no meaningful ranking the
 * scene is neutral. Absolutely positioned behind content: it never shifts layout.
 */
export function AtmosphereBackdrop() {
  const { pathname } = useLocation();
  const team = useStore((s) => s.gms.find((g) => g.id === s.viewerGmId)?.teamCode) || undefined;
  const ranking = useHumanRanking();
  const level = useMemo(() => atmosphereLevel(ranking, team), [ranking, team]);
  // Heavenly skies are bright, so the right side keeps only a light wash (the left, where titles sit, keeps its full one);
  // dark skies need no help. Panels and pills carry their own backgrounds.
  const bright = ranking.meaningful ? Math.max(0, (level - 0.5) * 2) : 0;
  const style = { "--scrim-left": (0.55 - 0.25 * bright).toFixed(2), "--scrim-mid": (0.4 - 0.34 * bright).toFixed(2), "--scrim-end": (0.4 - 0.38 * bright).toFixed(2) } as React.CSSProperties;
  if (OWN_BACKGROUND.has(pathname)) return null;
  return (
    <div className="atmo-backdrop" style={style} data-atmosphere={ranking.meaningful ? level.toFixed(2) : "neutral"} aria-hidden="true">
      <div className="atmo-layer"><StadiumScene team={team} level={level} /></div>
    </div>
  );
}
