export interface Policy {
  safeCharacters: RegExp;
  extra: ReadonlyArray<(command: string, ctx: { repoRoot: string; cwd: string }) => { ok: true; kind: string; argv: string[]; cwd: string } | { ok: false; reason: string } | null>;
}
export type Validated = { ok: true; kind: string; argv: string[]; cwd: string } | { ok: false; reason: string };
export const SAFE_COMMAND: RegExp;
export const ENV_RULES: Record<string, RegExp>;
export const DEFAULT_POLICY: Policy;
export function validateCommand(command: string, ctx: { repoRoot: string; cwd?: string; fileExists?: (path: string) => boolean; policy?: Policy }): Validated;
export function validateEnv(env?: Record<string, string>): { ok: true; env: Record<string, string> } | { ok: false; reason: string };
export function launchSpec(validated: { argv: string[] }, options?: { platform?: string; appendArgs?: string[] }): { file: string; args: string[]; shell: boolean; display: string };
