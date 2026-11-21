/**
 * Should the readiness gate be trying to make its move right now? Everyone is checked in and the engine is not
 * reported down. The gate's effect depends on this value, so it starts exactly once each time it turns true: when
 * the last GM checks in, and again when a successful Retry clears an engine notice, or a confirmed upgrade clears the hold, that interrupted the move.
 * Online the server owns the transition, so the gate never starts one.
 */
export function advanceWanted(s: { online: boolean; allReady: boolean; engineIssue: string | null; engineUpgrade?: boolean }): boolean {
  return !s.online && s.allReady && !s.engineIssue && !s.engineUpgrade;
}
