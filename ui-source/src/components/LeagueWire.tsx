import { useEffect, useState } from "react";

import { onlineSession, onOnlineChange, recentNews } from "@/state/online";
import { STAGE_LABEL } from "@/state/stageMachine";

/** A GM moving between their own screens: true, and noise to everyone else. */
const HIDDEN_KINDS = new Set(["step"]);
const SHOWN = 4;
/** Coming back after a day away, four lines isn't the story. */
const SHOWN_MORE = 20;

function ago(at: string): string {
  const ms = Date.now() - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/**
 * Events written before the server named its stages still say "moved on to
 * trainingCamp" — they're stored, so tidy them on the way out.
 */
function readable(summary: string): string {
  return summary
    // "extended Joey Porter Jr.." — a name that ends in a full stop, then the sentence's
    .replace(/\.\.$/, ".")
    .replace(/moved on to ([a-z][A-Za-z]+)(?= week| Week|\.|$)/, (whole, key: string) => {
    const label = (STAGE_LABEL as Record<string, string>)[key];
    return label ? `moved on to ${label}` : whole;
  });
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
  const [more, setMore] = useState(false);
  useEffect(() => {
    const off = onOnlineChange(() => bump((n) => n + 1));
    // the "5m ago" labels age even when nothing new arrives
    const tick = setInterval(() => bump((n) => n + 1), 60_000);
    return () => {
      off();
      clearInterval(tick);
    };
  }, []);

  const mine = onlineSession()?.teamCode;
  const items = recentNews()
    .filter((e) => !HIDDEN_KINDS.has(e.kind))
    // another GM's progress through the results is worth knowing; your own isn't news
    .filter((e) => !(e.kind === "reveal" && e.teamCode === mine));
  const shown = items.slice(-(more ? SHOWN_MORE : SHOWN)).reverse();
  if (items.length === 0) return null;
  return (
    <div className="leaguewire">
      <div className="railgroup">League wire</div>
      <ul>
        {shown.map((e) => (
          <li key={e.id}>
            {readable(e.summary)}
            <span className="when">{ago(e.at)}</span>
          </li>
        ))}
      </ul>
      {items.length > SHOWN && (
        <button type="button" className="wiremore" onClick={() => setMore((m) => !m)} aria-expanded={more}>
          {more ? "less" : `more (${Math.min(items.length, SHOWN_MORE) - SHOWN})`}
        </button>
      )}
    </div>
  );
}
