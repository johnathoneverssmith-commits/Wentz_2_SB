/** Read-only authoritative quotes for the offseason test; never applies a transaction. */
import { readFileSync, writeFileSync } from "node:fs";
import type { LeagueState, Player } from "../../ui-source/src/domain/index.ts";
import { contractValueFor } from "../../ui-source/src/sim/MockSimulationService.ts";
import { extensionAsk, wouldHoldOut } from "../../ui-source/src/state/contracts.ts";

const state = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as LeagueState & { priorPlayers: Record<string, { overall: number; position: Player["position"]; holdout: string | null }> };
const quotes = Object.fromEntries(Object.values(state.players)
  .map(p => [p.id, { eligible: !state.priorPlayers[p.id]?.holdout && wouldHoldOut(p, state.season), offer: extensionAsk(p), marketNow: contractValueFor(p.overall, p.position), marketBefore: state.priorPlayers[p.id] ? contractValueFor(state.priorPlayers[p.id]!.overall, state.priorPlayers[p.id]!.position) : null }]));
writeFileSync(process.argv[3]!, JSON.stringify(quotes));
