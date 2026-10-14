/**
 * Reads a command's output as it streams past, so the facts the verdict depends on survive no matter how much
 * output there is.
 *
 * The runner used to keep only the last 16,000 characters of a command's output and judge that. A database
 * suite prints its "schema applied" marker once, at the start, and a long run buried it: a successful database
 * check was reported as never having used a database. The same cut could drop a failing test's name that was
 * printed long before a green-looking summary.
 *
 * Here every chunk is scanned on arrival, line by line, with constant memory:
 *   - the lines the verdict reads (Vitest's `Tests` and `Test Files` summaries and the stress test's summary)
 *     are kept, up to a limit;
 *   - failing-test lines are counted exactly and their names kept (the first few);
 *   - type errors are counted, and the database markers are noted;
 *   - the log kept for people is bounded: the start and the end of the output, with the omission stated.
 *
 * The scanner is conservative where it has to give up: more summary lines than it keeps sets
 * `interestingOverflow`, which the verdict treats as unreadable, never as a pass.
 */

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const FAILURE_LINE = /^\s*(?:×|✗|✕|FAIL)\s+(.+?)(?:\s+\d+ms)?\s*$/;
const SUMMARY_LINE = /^\s*(?:Tests|Test Files)\s+/;
const STRESS_LINE = /(?:Invariant failures and crashes|Deterministic replay|Team seasons completed):/;
const DATABASE_USED = /\[test setup\] database schema applied once/;
const DATABASE_FAILED = /DATABASE SCHEMA NOT APPLIED/;

export const LIMITS = Object.freeze({
  /** The start of the output kept for people. */
  head: 4_000,
  /** The end of the output kept for people. */
  tail: 12_000,
  /** Summary lines kept for the verdict. A run prints a handful. */
  interesting: 200,
  /** Failing test names kept (the count is exact). */
  failureNames: 12,
  /** A single line longer than this is read in pieces, so one huge line cannot grow memory. */
  line: 64 * 1024,
  /** Each kept summary line is cut to this. */
  keptLine: 300,
});

/**
 * @param {Partial<typeof LIMITS>} [overrides]  for tests
 */
export function createCapture(overrides = {}) {
  const limits = { ...LIMITS, ...overrides };
  let head = "";
  let tail = "";
  let chars = 0;
  const partial = { stdout: "", stderr: "" };
  const signals = {
    interesting: [],
    interestingOverflow: 0,
    failureLines: 0,
    failureNames: [],
    tscErrors: 0,
    databaseUsed: false,
    databaseSetupFailed: false,
    lines: 0,
  };
  let finished = false;

  const scanLine = (raw) => {
    signals.lines++;
    const line = raw.replace(/\r$/, "").replace(ANSI, "");
    if (DATABASE_USED.test(line)) signals.databaseUsed = true;
    if (DATABASE_FAILED.test(line)) signals.databaseSetupFailed = true;
    const ts = line.match(/\berror TS\d+/g);
    if (ts) signals.tscErrors += ts.length;
    const failure = FAILURE_LINE.exec(line);
    if (failure) {
      signals.failureLines++;
      const name = (failure[1] ?? "").slice(0, limits.keptLine);
      if (signals.failureNames.length < limits.failureNames && !signals.failureNames.includes(name)) signals.failureNames.push(name);
    }
    if (SUMMARY_LINE.test(line) || STRESS_LINE.test(line)) {
      if (signals.interesting.length < limits.interesting) signals.interesting.push(line.slice(0, limits.keptLine));
      else signals.interestingOverflow++;
    }
  };

  const log = (text) => {
    chars += text.length;
    if (head.length < limits.head) head += text.slice(0, limits.head - head.length);
    tail = (tail + text).slice(-limits.tail);
  };

  return {
    /** Feed one chunk from one of the process's streams, in the order it arrived. */
    push(stream, chunk) {
      const text = String(chunk);
      log(text);
      const pieces = (partial[stream] + text).split("\n");
      partial[stream] = pieces.pop() ?? "";
      if (partial[stream].length > limits.line) {
        scanLine(partial[stream].slice(0, limits.line));
        partial[stream] = "";
      }
      for (const piece of pieces) scanLine(piece);
    },

    /** Ends the capture (the last line of a stream needs no newline) and returns what was learned. */
    result() {
      if (!finished) {
        finished = true;
        for (const stream of ["stdout", "stderr"]) {
          if (partial[stream]) scanLine(partial[stream]);
          partial[stream] = "";
        }
      }
      const omitted = Math.max(0, chars - limits.head - limits.tail);
      const text = omitted === 0 ? (chars <= limits.head ? head : head + tail.slice(-(chars - limits.head))) : `${head}\n... [${omitted} characters omitted] ...\n${tail}`;
      return { log: text, chars, omitted, signals: { ...signals, interesting: [...signals.interesting], failureNames: [...signals.failureNames] } };
    },
  };
}
