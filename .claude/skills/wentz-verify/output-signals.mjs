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

// Colour codes are removed from the text before it is split, held, overlapped or matched, so every position the
// scanner reasons about is a position in the same (plain) text. The parameters are bounded so a code can be held
// back whole when a chunk ends in the middle of one (ANSI_OPEN), and the two patterns agree on what a code is.
const ANSI = /\u001b\[[0-9;]{0,64}[A-Za-z]/g;
const ANSI_OPEN = /\u001b(?:\[[0-9;]{0,64})?$/;
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
  /** A single line longer than this is read in pieces, so one huge line cannot grow memory. Every piece is scanned. */
  line: 64 * 1024,
  /** How much of one piece is read again at the start of the next, so a marker split between two pieces is still seen. */
  overlap: 64,
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
  // a line cut into pieces: its first piece was scanned as a line, later ones only for what can sit anywhere in a line
  const continued = { stdout: false, stderr: false };
  // leading characters of the buffer that are overlap already scanned (matches wholly inside it are not counted twice)
  const carried = { stdout: 0, stderr: 0 };
  // the start of a colour code that a chunk ended in the middle of: held back until the next chunk completes it
  const openCode = { stdout: "", stderr: "" };
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

  /** What can appear anywhere in a line: type errors and the database markers. `skip` leading characters were seen before. */
  const scanAnywhere = (line, skip = 0, final = true) => {
    if (DATABASE_USED.test(line)) signals.databaseUsed = true;
    if (DATABASE_FAILED.test(line)) signals.databaseSetupFailed = true;
    // `skip`: leading characters that are overlap from the piece before. A match that ended inside them and before the
    // end of that piece was counted then. A match touching the end of a piece that is not the last is left for the
    // next piece, which still holds all of it (a match is at most 16 characters; the overlap is longer).
    for (const m of line.matchAll(/\berror TS\d{1,8}/g)) {
      const end = m.index + m[0].length;
      if (end < skip) continue;
      if (!final && end === line.length) continue;
      signals.tscErrors++;
    }
  };

  const scanLine = (raw, final = true) => {
    signals.lines++;
    const line = raw.replace(/\r$/, "");
    scanAnywhere(line, 0, final);
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

  /** The first piece of a line is scanned as a line; a later piece for what can sit anywhere in a line. */
  const scanPiece = (stream, text, final = true) => {
    if (continued[stream]) scanAnywhere(text.replace(/\r$/, ""), carried[stream], final);
    else scanLine(text, final);
  };

  return {
    /** Feed one chunk from one of the process's streams, in the order it arrived. */
    push(stream, chunk) {
      const raw = String(chunk);
      log(raw); // for people: as printed
      let text = openCode[stream] + raw;
      const open = ANSI_OPEN.exec(text);
      openCode[stream] = open ? open[0] : "";
      if (open) text = text.slice(0, open.index);
      text = text.replace(ANSI, "");
      const pieces = (partial[stream] + text).split("\n");
      partial[stream] = pieces.pop() ?? "";
      for (const piece of pieces) {
        scanPiece(stream, piece);
        continued[stream] = false;
        carried[stream] = 0;
      }
      // a line still open and too long to hold: scan what is held, keep only the overlap, go on
      while (partial[stream].length > limits.line) {
        scanPiece(stream, partial[stream], false);
        continued[stream] = true;
        const keep = Math.min(limits.overlap, partial[stream].length);
        partial[stream] = partial[stream].slice(-keep);
        carried[stream] = keep;
      }
    },

    /** Ends the capture (the last line of a stream needs no newline) and returns what was learned. */
    result() {
      if (!finished) {
        finished = true;
        for (const stream of ["stdout", "stderr"]) {
          // a colour code never completed is ordinary text
          partial[stream] += openCode[stream];
          openCode[stream] = "";
          // text that is only the overlap was scanned already, apart from a match left for this last piece
          if (partial[stream] && (partial[stream].length > carried[stream] || carried[stream] > 0)) scanPiece(stream, partial[stream]);
          partial[stream] = "";
        }
      }
      const omitted = Math.max(0, chars - limits.head - limits.tail);
      const text = omitted === 0 ? (chars <= limits.head ? head : head + tail.slice(-(chars - limits.head))) : `${head}\n... [${omitted} characters omitted] ...\n${tail}`;
      return { log: text, chars, omitted, signals: { ...signals, interesting: [...signals.interesting], failureNames: [...signals.failureNames] } };
    },
  };
}
