import type { LeagueState } from "@/domain";

type Note = { teamCode?: string | undefined; kind: string; summary: string; detail?: unknown };

/**
 * Feed lines raised by something that happened *to* the league rather than
 * by the action being applied — a stage-entry effect, say, which can run from
 * a ready-up, a commissioner override or a timer. Keyed by the state object,
 * so nothing is persisted; `withLeague` drains it into the same transaction.
 */
const pending = new WeakMap<LeagueState, Note[]>();

export function noteEvent(state: LeagueState, note: Note): void {
  const list = pending.get(state);
  if (list) list.push(note);
  else pending.set(state, [note]);
}

export function takeNotes(state: LeagueState): Note[] {
  const list = pending.get(state) ?? [];
  pending.delete(state);
  return list;
}
