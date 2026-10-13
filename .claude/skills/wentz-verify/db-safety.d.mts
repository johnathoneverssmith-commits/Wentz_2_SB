export const LOCAL_PGLITE_URL: string;
export function isDatabaseVariable(name: string): boolean;
export function baseEnvironment(parent?: Record<string, string | undefined>): Record<string, string>;
export function resolveTestDatabase(selection?: string | null): { ok: true; url: string; description: string } | { ok: false; reason: string };
export function environmentFor(
  check: { needsDatabase?: boolean },
  declared: Record<string, string>,
  options?: { parentEnv?: Record<string, string | undefined>; testDatabase?: string },
): { ok: true; env: Record<string, string>; database: string | null; databaseDigest?: string } | { ok: false; reason: string };
