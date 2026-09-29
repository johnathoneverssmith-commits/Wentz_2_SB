import { useEffect, useState } from "react";

import { onOnlineChange, recentNews } from "@/state/online";

/** A GM moving between their own screens: true, and noise to everyone else. */
const HIDDEN_KINDS = new Set(["step"]);
const SHOWN = 6;

function ago(at: string): string {
  const ms = Date.now() - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/**
 * What the other GMs have been doing, newest first.
 *
 * The stream delivered every signing, trade and pick to every client and the
 * client kept them — and then showed them nowhere, so an online league felt
 * like playing alone until the standings moved.
 */
export function LeagueWire() {
  const [, bump] = useState(0);
  useEffect(() => {
    const off = onOnlineChange(() => bump((n) => n + 1));
    // the "5m ago" labels age even when nothing new arrives
    const tick = setInterval(() => bump((n) => n + 1), 60_000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, []);

  const items = recentNews()
    .filter((e) => !HIDDEN_KINDS.has(e.kind))
    .slice(-SHOWN)
    .reverse();
  if (items.length === 0) return null;
  return (
    <div className="leaguewire">
      <div className="railgroup">League wire</div>
      <ul>
        {items.map((e) => (
          <li key={e.id}>
            {e.summary}
            <span className="when">{ago(e.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
