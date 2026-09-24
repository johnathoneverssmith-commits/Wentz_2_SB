import { parentPort } from "node:worker_threads";

import { simulateOne, type GameInput } from "./simGame.js";

parentPort?.on("message", (msg: { id: number; input: GameInput }) => {
  try {
    parentPort!.postMessage({ id: msg.id, result: simulateOne(msg.input) });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
