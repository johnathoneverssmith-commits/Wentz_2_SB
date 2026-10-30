/** Transient UI observation only; never part of LeagueState or a saved game. */
let pending = 0;
const listeners = new Set<() => void>();
export const isSetupCreating = (): boolean => pending > 0;
export function subscribeSetupCreation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function notify(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* A UI observer must not interrupt league creation. */ }
  }
}
/** Track the operation, not a route component: Back cannot release this lock. */
export function beginSetupCreation(): () => void {
  if (++pending === 1) notify();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    if (--pending === 0) notify();
  };
}
