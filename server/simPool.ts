/**
 * A pool of engine workers.
 *
 * A week is sixteen independent games, each a pure function of its seed and
 * rosters, and the adapter used to play them one after another on one core:
 * a nine-week block took ~4s. Spread across worker threads they finish in a
 * fraction of that, and they are the same games — nothing in them depends on
 * which thread played them or in what order. If workers cannot start, or one
 * fails, the game runs inline exactly as before.
 */
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import { simulateOne, type GameInput } from "./simGame.js";

type Result = ReturnType<typeof simulateOne>;

interface Job {
  resolve: (r: Result) => void;
  reject: (e: Error) => void;
}

const SIZE = Math.max(1, Math.min(8, availableParallelism() - 1));
let started = false;
let failed = SIZE < 2; // one core: a worker only adds overhead
const pending = new Map<number, Job>();
const idle: Worker[] = [];
const queue: { id: number; input: GameInput }[] = [];
let nextId = 1;

function start(): boolean {
  if (failed) return false;
  if (started) return true;
  started = true;
  try {
    for (let n = 0; n < SIZE; n++) {
      const w = new Worker(new URL("./simWorker.ts", import.meta.url), { execArgv: ["--import", "tsx"] });
      w.on("message", (msg: { id: number; result?: Result; error?: string }) => {
        const job = pending.get(msg.id);
        pending.delete(msg.id);
        if (job) {
          if (msg.error !== undefined) job.reject(new Error(msg.error));
          else job.resolve(msg.result!);
        }
        const next = queue.shift();
        if (next) w.postMessage(next);
        else idle.push(w);
      });
      w.on("error", () => {
        failed = true;
      });
      w.unref();
      idle.push(w);
    }
    return true;
  } catch {
    failed = true;
    return false;
  }
}

/** Start the workers now, so the first block doesn't pay for their startup. */
export function warmPool(): void {
  start();
}

export function runGame(input: GameInput): Promise<Result> {
  if (!start()) return Promise.resolve(simulateOne(input));
  return new Promise<Result>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const w = idle.pop();
    if (w) w.postMessage({ id, input });
    else queue.push({ id, input });
  }).catch(() => simulateOne(input)); // a worker failure still plays the game
}
