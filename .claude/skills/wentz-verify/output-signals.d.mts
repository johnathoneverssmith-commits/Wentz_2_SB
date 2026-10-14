export interface Signals {
  /** The Vitest and stress-test summary lines found in the whole output (bounded). */
  interesting: string[];
  /** How many summary lines beyond the limit were not kept; non-zero means the output cannot be read reliably. */
  interestingOverflow: number;
  /** Exact count of failing-test lines in the whole output. */
  failureLines: number;
  failureNames: string[];
  tscErrors: number;
  databaseUsed: boolean;
  databaseSetupFailed: boolean;
  lines: number;
}
export interface Captured {
  /** For people: the start and end of the output, with the omission stated. */
  log: string;
  chars: number;
  omitted: number;
  signals: Signals;
}
export interface Capture {
  push(stream: "stdout" | "stderr", chunk: string): void;
  result(): Captured;
}
export const LIMITS: Readonly<{ head: number; tail: number; interesting: number; failureNames: number; line: number; overlap: number; keptLine: number }>;
export function createCapture(overrides?: Partial<{ head: number; tail: number; interesting: number; failureNames: number; line: number; overlap: number; keptLine: number }>): Capture;
