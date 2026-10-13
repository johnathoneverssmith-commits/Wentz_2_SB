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
}
export function parseRemote(url: string): { owner: string; repo: string } | null;
export function validateCiEvidence(args: { headSha: string; dirty: boolean; runs: unknown; jobsFor: (runId: number) => unknown }): CiEvidence;
export function fetchCiEvidence(args: {
  owner?: string;
  repo?: string;
  headSha: string;
  dirty: boolean;
  fetchImpl?: typeof fetch;
  token?: string;
  now?: () => Date;
}): Promise<CiEvidence>;
