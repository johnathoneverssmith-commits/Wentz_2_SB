// Types for select-checks.mjs, so test/verify-selector.test.ts is type-checked against it.

export type Source = "committed" | "staged" | "unstaged" | "untracked";
export type Level = "REQUIRED" | "RECOMMENDED";

export interface RawChange {
  path: string;
  status: string;
  source: Source;
  oldPath?: string;
}

export interface Change {
  path: string;
  status: string;
  sources: Source[];
  oldPath?: string;
  renamedTo?: string;
}

export interface IndexedTest {
  path: string;
  project: string;
  projectRoot: string;
  imports: string[];
}

export interface Check {
  id: string;
  level: Level;
  kind: "command" | "manual" | "ci";
  tier: number;
  label: string;
  commands: string[];
  /** Directory (relative to the repo root) the commands run in; absent means the repo root. */
  cwd?: string;
  /** How the result is read: "vitest" (summary lines), "stress" (its own summary) or "exit" (exit code only). */
  parser?: "vitest" | "stress" | "exit";
  files: string[];
  reasons: string[];
  needsDatabase: boolean;
  env?: Record<string, string>;
  prerequisite?: string;
  seconds?: { local: number; ci: number | null };
  note?: string;
  authoritative?: boolean;
}

export interface PlanRow {
  path: string;
  oldPath?: string;
  renamedTo?: string;
  status: string;
  sources: Source[];
  class: string;
}

export interface Plan {
  version: number;
  base: string | null;
  mergeBase: string | null;
  empty: boolean;
  conservative: boolean;
  risk: "none" | "low" | "medium" | "high" | "conservative";
  classes: string[];
  changes: PlanRow[];
  unknownSourcePaths: string[];
  unclassifiedPaths: string[];
  scratchPaths: string[];
  problems: string[];
  warnings: string[];
  approvalsNeeded: string[];
  notes: string[];
  needsDatabase: boolean;
  required: Check[];
  recommended: Check[];
  limitations: string[];
  localVersusCi: string;
}

export interface RiskMapRule {
  id: string;
  class: string;
  risk: string;
  component?: string;
  match: string[];
  requires: string[];
  recommends?: string[];
  approval?: string;
  notes?: string[];
}

export interface RiskMap {
  version: number;
  sourceExtensions: string[];
  projects: Record<string, { prefixes: string[] }>;
  testTrees: { project: string; dir: string; root: string }[];
  databaseSuites: string[];
  scratch: string[];
  unknown: { conservative: string[]; why: string };
  limitations: string[];
  checks: Record<string, { kind: string; tier: number; label: string; commands: string[]; env?: Record<string, string>; [k: string]: unknown }>;
  rules: RiskMapRule[];
}

export interface Context {
  base?: string | null;
  mergeBase?: string | null;
  baseMissing?: boolean;
  warnings?: string[];
}

export const RISK_ORDER: string[];
export function loadMap(path?: string): RiskMap;
export function expandBraces(glob: string): string[];
export function globToRegExp(glob: string): RegExp;
export function compileGlobs(globs: string[]): RegExp[];
export function matchesAny(path: string, globs: string[]): boolean;
export function parseNameStatus(text: string, source: Source): RawChange[];
export function parseUntracked(text: string): RawChange[];
export function mergeChanges(entries: RawChange[]): Change[];
export function collectChanges(options?: { cwd?: string; base?: string; includeUntracked?: boolean }): {
  changes: Change[];
  mergeBase: string | null;
  base: string;
  baseMissing: boolean;
  warnings: string[];
};
export function isSourceLike(path: string, map: RiskMap): boolean;
export function looksLikeScratch(path: string, map: RiskMap): boolean;
export function classify(path: string, map: RiskMap): { kind: "rule"; rule: RiskMapRule } | { kind: "unknown-source" | "unclassified" };
export function projectOf(path: string, map: RiskMap): string | null;
export function isTestFile(path: string): boolean;
export function parseNameStatusZ(text: string, source: Source): RawChange[];
export function parseUntrackedZ(text: string): RawChange[];
export function isCodeFile(path: string): boolean;
export function extractSpecifiers(source: string): string[];
export function specifierKey(spec: string, fromPath: string): string | null;
export function buildTestIndex(root: string, map: RiskMap): IndexedTest[];
export function directTestsFor(path: string, testIndex: IndexedTest[]): IndexedTest[];
export function plan(args: { changes: Change[]; testIndex: IndexedTest[]; map: RiskMap; context?: Context }): Plan;
export function renderText(p: Plan): string;
export function main(argv?: string[]): number;
