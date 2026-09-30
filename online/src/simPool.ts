import { Worker } from "node:worker_threads";

import type { LeagueState } from "@/domain";

import { type BlockJob, runBlockJob } from "./blockJobs.js";

/**
 * One long-lived worker for block simulation (see `blockJobs.ts`).
 *
 * One is enough: a league's transaction holds its row lock while it waits,
 * so two blocks for the same league never overlap, and two leagues finishing
 * a stage in the same second is rare enough to queue. If the worker can't be
 * started, or dies, the job runs in-process — slower for everyone else, but
 * never a league that can't advance.
 */
let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const waiting = new Map<number, { resolve: (s: LeagueState) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (broken) return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL("./simWorker.ts", import.meta.url));
    w.unref();
    w.on("message", (msg: { id: number; state?: LeagueState; error?: string }) => {
      const p = waiting.get(msg.id);
      if (!p) return;
      waiting.delete(msg.id);
      if (msg.error || !msg.state) p.reject(new Error(msg.error ?? "simulation worker returned nothing"));
      else p.resolve(msg.state);
    });
    const fail = (err: unknown) => {
      console.error("simulation worker failed; running blocks in-process", err);
      broken = true;
      worker = null;
      for (const [, p] of waiting) p.reject(new Error("simulation worker exited"));
      waiting.clear();
    };
    w.on("error", fail);
    w.on("exit", (code) => {
      if (code !== 0) fail(new Error(`exit ${code}`));
      worker = null;
    });
    worker = w;
    return w;
  } catch (err) {
    console.error("couldn't start the simulation worker; running blocks in-process", err);
    broken = true;
    return null;
  }
}

/** Plays `jobs` against `state` and returns the state they produce. */
export async function runBlockJobs(state: LeagueState, jobs: BlockJob[]): Promise<LeagueState> {
  if (jobs.length === 0) return state;
  const w = getWorker();
  if (w) {
    try {
      return await new Promise<LeagueState>((resolve, reject) => {
        const id = nextId++;
        waiting.set(id, { resolve, reject });
        w.postMessage({ id, state, jobs });
      });
    } catch (err) {
      // a dead worker is not the league's fault: play it on this thread
      // instead (a job that genuinely throws will throw here too)
      console.error("block simulation in the worker failed; retrying in-process", err);
    }
  }
  for (const job of jobs) runBlockJob(state, job);
  return state;
}
