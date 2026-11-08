/**
 * Deliberate deviations from the generic rules, each with its reason and where it was decided. A finding that matches is
 * still recorded (as "accepted") so the report shows it; it just does not fail the run or enter the defect register.
 * Add to this list only with a citation; an entry without one is rejected by the self-check.
 */
import type { Finding } from "./probes.ts";

export interface KnownException {
  screen: string | RegExp;
  rule: string;
  /** Matches the finding's detail or signature. */
  match?: RegExp;
  reason: string;
  /** Where the decision is written down. */
  cite: string;
}

export const KNOWN_EXCEPTIONS: readonly KnownException[] = [
  {
    screen: "setup",
    rule: "h1-count",
    match: /League Setup/,
    reason: "League Setup deliberately keeps both h1s (\"League Setup\" and the game title): existing specs and the journey-usability tests look for each.",
    cite: "PR #84 description, 'League Setup' bullet",
  },
];

export function acceptedBy(screen: string, f: Finding): KnownException | null {
  for (const e of KNOWN_EXCEPTIONS) {
    if (e.rule !== f.rule) continue;
    if (typeof e.screen === "string" ? e.screen !== screen : !e.screen.test(screen)) continue;
    if (e.match && !e.match.test(`${f.sig} ${f.detail}`)) continue;
    return e;
  }
  return null;
}
