export const WORKFLOW_PATH: string;
export const WORKFLOW_NAME: string;
export interface CiEvidence {
  validated: boolean;
  reason?: string;
  failed?: boolean;
  source?: string;
  event?: string;
  headSha?: string;
  runId?: number;
  runUrl?: string;
  test?: string;
  deploy?: string;
  workflow?: string;
  retrievedAt?: string;
  pr?: { number: number; baseRef: string; headRef: string | null; url: string | null };
}
export function parseRemote(url: string): { owner: string; repo: string } | null;
export function validateCiEvidence(args: { headSha: string; dirty: boolean; runs: unknown; jobsFor: (runId: number) => unknown; pullFor?: (number: number) => unknown; repoFullName?: string; expectedBase?: string; expectedPr?: number }): CiEvidence;
export function fetchCiEvidence(args: {
  owner?: string;
  repo?: string;
  headSha: string;
  dirty: boolean;
  expectedBase?: string;
  expectedPr?: number;
  fetchImpl?: typeof fetch;
  token?: string;
  now?: () => Date;
}): Promise<CiEvidence>;
