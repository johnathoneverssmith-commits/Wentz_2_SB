import type { LeagueState } from "@/domain";

/**
 * Fields of a player that stay on the server.
 *
 * `potential` is a hidden ceiling: no screen shows it and no game rule discloses it, but the league
 * document used to carry it for every player to every member. It is removed, whole, from what a client
 * receives. No rounded or noisy stand-in is sent either (a coarse ceiling still tells a GM who the
 * high-upside players are). The saved league keeps the true value: development, camp, contract and
 * trade decisions all run on the server, from the stored state.
 *
 * Without it the client prices a player on the league development curve for his age (`contractValue.ts`
 * treats a missing ceiling that way), which is all the information the client legitimately has.
 */
export function stripPrivatePlayerFields(state: LeagueState): void {
  for (const p of Object.values(state.players)) delete p.potential;
}

/**
 * A prospect's true rating is the draft's one hidden fact: it shows only once the pick is signed or released. It went
 * out with every pull for all 320 prospects, so any GM with the developer tools open could read the busts off the
 * board before drafting. Masked here for every viewer, whoever they are.
 */
export function maskUnsettledProspects(state: LeagueState): void {
  state.draftClass = (state.draftClass ?? []).map((pr) =>
    state.rookieOutcomes?.[pr.id] ? pr : { ...pr, trueOverall: 0 },
  );
}
