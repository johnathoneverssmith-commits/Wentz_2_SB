import type { Check, Plan } from "./select-checks.mjs";
import type { RunRecord } from "./verdict.mjs";

export function refusal(command: string): string | null;
export function selectChecks(
  plan: Plan,
  options?: { ids?: string[] | null; tierMax?: number; level?: "required" | "all"; withDatabase?: boolean },
): Check[];
export function runCheck(check: Check, options?: { cwd?: string; timeoutSec?: number; log?: (line: string) => void }): RunRecord & { commands: string[] };
export function main(argv?: string[]): number;
