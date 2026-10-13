import type { Check, Plan } from "./select-checks.mjs";
import type { RunRecord } from "./verdict.mjs";
import type { Policy } from "./command-policy.mjs";

export function refusal(command: string, options?: { repoRoot?: string; cwd?: string; policy?: Policy; fileExists?: (path: string) => boolean }): string | null;
export function selectChecks(
  plan: Plan,
  options?: { ids?: string[] | null; tierMax?: number; level?: "required" | "all"; testDatabase?: string },
): Check[];
export function runCheck(
  check: Check,
  options?: {
    cwd?: string;
    timeoutSec?: number;
    log?: (line: string) => void;
    policy?: Policy;
    parentEnv?: Record<string, string | undefined>;
    testDatabase?: string;
    platform?: string;
    fileExists?: (path: string) => boolean;
  },
): RunRecord & { commands: string[]; exitCode: number | null; output: string; durationSec: number; timedOut: boolean };
export function main(argv?: string[]): number;
