import { useEffect, useMemo, useState } from "react";

import { TeamBadge } from "@/components/bits";
import { waitingStakes } from "@/state/stakes";
import { useStore } from "@/state/store";
import { tipsFor } from "@/state/tips";

/**
 * What each GM in the league has riding on the moment, for a screen that is
 * waiting on somebody. A wait is dead time; this is what is worth knowing
 * about the people being waited on.
 */
export function WaitingStakes() {
  const state = useStore();
  const viewer = useStore((s) => s.viewerGmId);
  const gms = useStore((s) => s.gms);
  const stakes = useMemo(() => waitingStakes(state), [state]);
  // a tip that changes while you wait, starting somewhere different for each
  // GM so the people waiting together are not all reading the same one
  const tips = useMemo(() => tipsFor(state.stage), [state.stage]);
  const [at, setAt] = useState(() => [...viewer].reduce((n, c) => n + c.charCodeAt(0), 0) % Math.max(1, tips.length));
  useEffect(() => {
    const t = setInterval(() => setAt((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);
  if (stakes.length === 0 && tips.length === 0) return null;
  const mine = gms.find((g) => g.id === viewer)?.teamCode;
  return (
    <div className="stakes" aria-label="What each GM has riding on this">
      <p className="msection" style={{ marginTop: 0 }}>
        What&rsquo;s at stake
      </p>
      {stakes.map((k) => (
        <div key={k.teamCode} className="stakes-row">
          <TeamBadge code={k.teamCode} size={28} />
          <div>
            <small>
              {k.gmName}
              {k.teamCode === mine ? " (you)" : ""}
            </small>
            <p>{k.line}</p>
          </div>
        </div>
      ))}
      {tips.length > 0 && (
        <p className="stakes-tip" role="note">
          <strong>Tip</strong> {tips[at % tips.length]}
        </p>
      )}
    </div>
  );
}
