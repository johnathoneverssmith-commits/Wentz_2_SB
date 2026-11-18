/** Browser build stand-in for `data/players.ts`: no default pool exists off the filesystem, the host must supply one. */
import type { Player } from "../../schema/player.js";

export function resolveDefaultPoolPath(): string {
  throw new Error("no default player pool in the browser: send init with a pool first");
}

export function loadPlayerPool(): Player[] {
  throw new Error("no default player pool in the browser: send init with a pool first");
}
