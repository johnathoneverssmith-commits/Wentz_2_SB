import type { ReactNode } from "react";
import type { Player } from "@/domain";

/**
 * INTEGRATION POINT FOR THE PLAYER-PORTRAIT SYSTEM (Agent 4).
 *
 * Every surface that wants a portrait renders `<PortraitSlot player={p} />`.
 * Today it shows a neutral silhouette. To plug in generated portraits, either
 * pass `children` (an <img>/<svg> for this player) or replace the body of
 * `DefaultPortrait` below with a lookup on `player.id`. Nothing else in the
 * dossier needs to change. The slot keeps a fixed 3:4 box so layout never
 * shifts when a real image loads.
 */
export function PortraitSlot({ player, children, size = 120 }: { player: Pick<Player, "id" | "name" | "position">; children?: ReactNode; size?: number }) {
  return (
    <div className="portrait-slot" data-portrait-slot={player.id} style={{ width: size, height: Math.round((size * 4) / 3) }} role="img" aria-label={`Portrait of ${player.name}`}>
      {children ?? <DefaultPortrait position={player.position} />}
    </div>
  );
}

function DefaultPortrait({ position }: { position: string }) {
  return (
    <div className="portrait-default" aria-hidden="true">
      <svg viewBox="0 0 90 120" width="100%" height="100%"><circle cx="45" cy="38" r="20" fill="currentColor" opacity=".55"/><path d="M8 120 C8 82 26 68 45 68 S82 82 82 120Z" fill="currentColor" opacity=".45"/></svg>
      <span>{position}</span>
    </div>
  );
}
