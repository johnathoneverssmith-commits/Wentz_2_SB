import { useEffect, useState } from "react";

import { onEngineProgress } from "@/sim/engineWorker";
import type { Progress } from "@/sim/engineWorker/client";

const mb = (n: number) => (n / 1_048_576).toFixed(1);

/** What the engine is doing while a player waits on it, or nothing once it is ready. Shown on the screens that wait. */
export function engineProgressText(p: Progress): string {
  if (p.stage === "manifest") return "Looking for the game engine…";
  if (p.stage === "start") return "Starting the game engine…";
  const pct = p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
  return `Getting the game engine (first time only): ${mb(p.loaded)} of ${mb(p.total)} MB, ${pct}%`;
}

export function EngineProgressLine({ className }: { className?: string }) {
  const [p, setP] = useState<Progress | null>(null);
  useEffect(() => onEngineProgress(setP), []);
  if (!p) return null;
  const pct = p.stage === "download" && p.total > 0 ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : undefined;
  return (
    <div className={className} data-testid="engine-progress" role="status" aria-live="polite">
      {engineProgressText(p)}
      {pct !== undefined && <progress value={pct} max={100} aria-label="Game engine download" style={{ display: "block", width: "100%", marginTop: 6 }} />}
    </div>
  );
}
