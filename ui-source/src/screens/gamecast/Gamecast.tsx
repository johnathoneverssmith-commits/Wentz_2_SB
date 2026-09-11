/**
 * The live field visualisation, embedded verbatim from the standalone
 * "Gamecast" artifact built + polished this session (full-game play-by-play,
 * ball tracking, punts/field goals, colored player names, quarter/injury
 * interstitials, play/pause/speed/skip transport — see that artifact's own
 * history for the design work).
 *
 * Rendered as a sandboxed iframe rather than ported line-by-line into React:
 * the artifact is already tested and reviewed, it's self-contained (own
 * fonts/CSS/state machine, no host dependencies), and an iframe means its
 * global `document.addEventListener`s and `setInterval` timer can't leak
 * into the host app or collide with anything else on the page. It keeps its
 * own visual identity (turf green / broadcast-amber) rather than the app's
 * theme — a deliberate scope line for this pass; re-skinning it to the app's
 * palette is a reasonable follow-up, not a rewrite.
 *
 * Team-code note: `gc-body.js` is a straight copy of the artifact's script
 * with one fix — its color/nickname lookup tables key the Rams as `LAR`
 * (this app's convention) instead of the engine's `LA`.
 */
import { useMemo } from "react";

import type { GameResult } from "@/domain";

// Vite's `?raw` suffix imports the file's contents as a string at build time.
import gcHead from "./gc-head.html?raw";
import gcBody from "./gc-body.js?raw";

export function Gamecast({ game }: { game: GameResult }) {
  const srcDoc = useMemo(() => {
    if (!game.broadcast) return null;
    const data = JSON.stringify(game.broadcast).replace(/</g, "\\u003c");
    return gcHead.replace("__DATA__", data) + gcBody + "</script>";
  }, [game.broadcast]);

  if (!srcDoc) return null;

  return (
    <iframe
      title="Gamecast"
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-same-origin"
      style={{
        width: "100%",
        height: "min(78vh, 900px)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-md)",
        colorScheme: "light",
      }}
    />
  );
}
