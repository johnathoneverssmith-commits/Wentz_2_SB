import { parentPort } from "node:worker_threads";

import type { LeagueState } from "@/domain";

import { type BlockJob, runBlockJob } from "./blockJobs.js";

/** Runs block jobs off the main thread; see `blockJobs.ts`. */
parentPort?.on("message", (msg: { id: number; state: LeagueState; jobs: BlockJob[] }) => {
  try {
    for (const job of msg.jobs) runBlockJob(msg.state, job);
    parentPort!.postMessage({ id: msg.id, state: msg.state });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
  }
});
