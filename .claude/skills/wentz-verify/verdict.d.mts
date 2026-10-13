// Types for verdict.mjs, so test/verify-verdict.test.ts is type-checked against it.
import type { Check, Plan } from "./select-checks.mjs";

export type Status = "PASSED" | "FAILED" | "SKIPPED" | "NOT_RUN" | "PENDING_CI" | "CONFIRMED";
export type Verdict = "BLOCKED" | "FAILED" | "INCOMPLETE" | "LOCALLY_VERIFIED" | "VERIFIED";

export interface RunRecord {
  id: string;
  attempt?: number;
  exitCode?: number | null;
  output?: string;
  timedOut?: boolean;
  error?: string;
  durationSec?: number;
  status?: Status;
  detail?: string;
  evidence?: string;
  binding?: { planDigest: string; commandDigest: string; head: string | null; treeDigest: string | null; databaseDigest?: string | null };
  commands?: string[];
  database?: string;
  databaseDigest?: string;
  ci?: { test?: string; deploy?: string; event?: string; validated?: boolean; failed?: boolean; reason?: string; headSha?: string; runId?: number };
}

export interface Judgement {
  id: string;
  status: Status;
  detail: string;
  durationSec: number | null;
  failures?: string[];
  skipped?: number;
  stale?: boolean;
  flaky?: boolean;
}

export interface Row extends Judgement {
  label: string;
  level: "REQUIRED" | "RECOMMENDED";
  kind: string;
  commands: string[];
  needsDatabase: boolean;
  evidence: string | null;
  attempt?: number | null;
  earlierFailures?: Array<{ attempt: number | null; detail: string }>;
}

export interface Summary {
  verdict: Verdict;
  base: string | null;
  risk: string;
  conservative: boolean;
  rows: Row[];
  failed: string[];
  notRun: string[];
  stale: string[];
  flaky: string[];
  earlierFailures: Array<{ id: string; attempt: number | null; detail: string }>;
  attestedOnly: string[];
  recommendedNotRun: string[];
  unplanned: string[];
  problems: string[];
  approvalsNeeded: string[];
  needsDatabase: boolean;
  limitations: string[];
  notes: string[];
  ciRequired: boolean;
}

export interface Counts { passed: number; failed: number; skipped: number; todo: number; total: number; summaries: number }

export interface Parsed {
  tests: Counts | null;
  files: Counts | null;
  failures: string[];
  tscErrors: number;
  databaseUsed: boolean;
  databaseSetupFailed: boolean;
}

export interface SummarizeContext {
  /** The repository now (from `fingerprint`). Absent means bindings are not checked. */
  state?: { head?: string; dirty?: boolean; digest?: string; error?: string };
  /** Digest of the test database selected now, if any: a database check must have run against it. */
  databaseDigest?: string;
  /** From `fetchCiEvidence`. Only `validated: true` can produce VERIFIED. */
  ciEvidence?: { validated: boolean; reason?: string; failed?: boolean; headSha?: string; test?: string; deploy?: string; event?: string; runId?: number; runUrl?: string; pr?: { number: number } };
  /** A person's claim about CI: shown, never believed. */
  attestedCi?: { test?: string; deploy?: string; event?: string };
}

export const VERDICTS: Verdict[];
export const STATUSES: Status[];
export function parseTestOutput(raw?: string): Parsed;
export function parseStressOutput(raw?: string): { invariantFailures: number | null; replay: string | null; teamSeasons: number | null };
export function parserFor(check: Pick<Check, "commands">): "vitest" | "stress" | "exit";
export function judge(check: Pick<Check, "id" | "kind" | "commands" | "needsDatabase">, run: RunRecord | undefined): Judgement;
export function summarize(plan: Plan, results?: RunRecord[], context?: SummarizeContext): Summary;
export function renderReport(summary: Summary): string;
export function exitCodeFor(verdict: Verdict): number;
