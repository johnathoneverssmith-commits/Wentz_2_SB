// Types for verdict.mjs, so test/verify-verdict.test.ts is type-checked against it.
import type { Check, Plan } from "./select-checks.mjs";

export type Status = "PASSED" | "FAILED" | "SKIPPED" | "NOT_RUN" | "PENDING_CI" | "CONFIRMED";
export type Verdict = "BLOCKED" | "FAILED" | "INCOMPLETE" | "LOCALLY_VERIFIED" | "VERIFIED";

export interface RunRecord {
  id: string;
  exitCode?: number | null;
  output?: string;
  timedOut?: boolean;
  error?: string;
  durationSec?: number;
  status?: Status;
  detail?: string;
  ci?: { test?: string; deploy?: string; event?: string };
}

export interface Judgement {
  id: string;
  status: Status;
  detail: string;
  durationSec: number | null;
  failures?: string[];
  skipped?: number;
}

export interface Row extends Judgement {
  label: string;
  level: "REQUIRED" | "RECOMMENDED";
  kind: string;
  commands: string[];
  needsDatabase: boolean;
}

export interface Summary {
  verdict: Verdict;
  base: string | null;
  risk: string;
  conservative: boolean;
  rows: Row[];
  failed: string[];
  notRun: string[];
  recommendedNotRun: string[];
  unplanned: string[];
  problems: string[];
  approvalsNeeded: string[];
  needsDatabase: boolean;
  limitations: string[];
  notes: string[];
  ciRequired: boolean;
}

export interface Parsed {
  tests: { passed: number; failed: number; skipped: number; todo: number; total: number } | null;
  files: { passed: number; failed: number; skipped: number; todo: number; total: number } | null;
  failures: string[];
  tscErrors: number;
  databaseUsed: boolean;
  databaseSetupFailed: boolean;
}

export const VERDICTS: Verdict[];
export const STATUSES: Status[];
export function parseTestOutput(raw?: string): Parsed;
export function judge(check: Pick<Check, "id" | "kind" | "commands" | "needsDatabase">, run: RunRecord | undefined): Judgement;
export function summarize(plan: Plan, results?: RunRecord[]): Summary;
export function renderReport(summary: Summary): string;
export function exitCodeFor(verdict: Verdict): number;
