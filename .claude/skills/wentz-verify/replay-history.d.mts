import type { Plan, RawChange, RiskMap, IndexedTest } from "./select-checks.mjs";

export interface ReplayEntry {
  pr: number;
  title: string;
  merge: string;
  parent: string;
  changes: RawChange[];
}
export interface Brief {
  risk: string;
  classes: string[];
  conservative: boolean;
  required: string[];
  recommended: string[];
  approvals: string[];
  needsDatabase: boolean;
  concurrencyCiOnly: boolean;
}
export function loadFixtures(path: string): ReplayEntry[];
export function replay(entry: ReplayEntry, options: { map?: RiskMap; testIndex: IndexedTest[] }): Plan;
export function brief(plan: Plan): Brief;
export function capture(options: { merge: string; pr: number | string; title: string; cwd?: string }): ReplayEntry;
export function main(argv?: string[]): number;
