import type { Check, Plan } from "./select-checks.mjs";
import type { RunRecord } from "./verdict.mjs";

export interface RepoState {
  head: string;
  dirty: boolean;
  files: Array<{ path: string; hash: string }>;
  config: Array<{ path: string; hash: string }>;
  digest: string;
  error?: undefined;
}
export type StateOrError = RepoState | { error: string };
export interface History { version: 2; runs: RunRecord[] }

export function sha256(text: string | Buffer): string;
export function canonical(value: unknown): string;
export function commandDigest(check: Partial<Check> & { id: string }): string;
export function planDigest(plan: Partial<Plan>): string;
export function parsePorcelainZ(text: string): string[];
export function fingerprint(cwd: string): StateOrError;
export function bindingFor(check: Partial<Check> & { id: string }, plan: Partial<Plan>, state: { head: string | null; digest: string | null }): NonNullable<RunRecord["binding"]>;
export function bindingProblems(run: RunRecord | undefined, check: Partial<Check> & { id: string }, plan: Partial<Plan>, state: StateOrError | undefined): string[];
export function normalizeHistory(data: unknown): History;
export function appendRun(history: History, run: RunRecord): History;
export function attemptsFor(history: History, id: string): RunRecord[];
