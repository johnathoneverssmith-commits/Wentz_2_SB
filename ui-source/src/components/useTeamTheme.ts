import { useEffect } from "react";

import { deepen, TEAMS_BY_CODE } from "@/data/teams";
import { useStore } from "@/state/store";

/**
 * Push the controlled team's brand color into --team / --team-deep on :root
 * (spec §2: the team color is dynamic per GM). Falls back to the reference
 * Cleveland orange when no team is selected yet.
 */
export function useTeamTheme(): void {
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  const code = gms.find((g) => g.id === viewerGmId)?.teamCode;

  useEffect(() => {
    const root = document.documentElement;
    const meta = code ? TEAMS_BY_CODE[code] : undefined;
    if (meta) {
      root.style.setProperty("--team", meta.color);
      root.style.setProperty("--team-deep", deepen(meta.color));
    } else {
      root.style.removeProperty("--team");
      root.style.removeProperty("--team-deep");
    }
  }, [code]);
}
