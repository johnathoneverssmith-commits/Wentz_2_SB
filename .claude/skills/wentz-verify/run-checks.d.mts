import type { Check, Plan } from "./select-checks.mjs";
import type { RunRecord } from "./verdict.mjs";
import type { Policy } from "./command-policy.mjs";
import type { Capture } from "./output-signals.mjs";

export function refusal(command: string, options?: { repoRoot?: string; cwd?: string; policy?: Policy; fileExists?: (path: string) => boolean }): string | null;
export function selectChecks(
  plan: Plan,
  options?: { ids?: string[] | null; tierMax?: number; level?: "required" | "all"; testDatabase?: string },
): Check[];
export function killTree(pid: number | undefined, options?: { platform?: string }): void;
export function runProcess(
  spec: { file: string; args: string[]; shell: boolean },
  options: { cwd: string; env: Record<string, string>; timeoutMs: number; maxBytes?: number; platform?: string; capture?: Capture },
): Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean; error?: string }>;
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
): Promise<RunRecord & { commands: string[]; exitCode: number | null; output: string; durationSec: number; timedOut: boolean }>;
export function main(argv?: string[]): Promise<number>;
