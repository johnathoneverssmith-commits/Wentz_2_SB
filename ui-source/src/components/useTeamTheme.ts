import { useEffect } from "react";

import { deepen, readableAccent, TEAMS_BY_CODE } from "@/data/teams";
import { useStore } from "@/state/store";

/**
 * Push the controlled team's brand into --team / --team-deep / --team-on on
 * :root (spec §2: the team color is dynamic per GM). --team is the *readable*
 * accent (a team's lighter secondary when its primary is too dark for the
 * dark theme — see readableAccent); --team-deep is always the true primary,
 * darkened, for the header wash. Falls back to the reference Cleveland orange
 * when no team is selected yet.
 */
export function useTeamTheme(): void {
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const code = gms.find((g) => g.id === viewerGmId)?.teamCode;

  useEffect(() => {
    const root = document.documentElement;
    const meta = code ? TEAMS_BY_CODE[code] : undefined;
    if (meta) {
      const accent = readableAccent(meta);
      root.style.setProperty("--team", accent.color);
      root.style.setProperty("--team-on", accent.onColor);
      root.style.setProperty("--team-deep", deepen(meta.color, 0.72));
    } else {
      root.style.removeProperty("--team");
      root.style.removeProperty("--team-on");
      root.style.removeProperty("--team-deep");
    }
  }, [code]);
}
