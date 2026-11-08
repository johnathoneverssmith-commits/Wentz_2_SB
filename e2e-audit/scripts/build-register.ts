/**
 * Builds the defect register from one run's records plus the hand-written entries.
 *
 *   npm run audit:register                      # AUDIT_OUT or e2e-audit/audit-output/local
 *
 * Writes <out>/defect-register.json and <out>/DEFECT_REGISTER.md. Reads only; never touches the app or any league.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CaptureRecord } from "../support/audit-test.ts";
import { OUT_DIR, HERE } from "../support/paths.ts";
import { fromManual, groupFindings, renderMarkdown, validateManual, type Defect, type ManualDefect } from "../support/register.ts";

const recFile = join(OUT_DIR, "records.jsonl");
if (!existsSync(recFile)) throw new Error(`no records at ${recFile}: run \`npm run audit:visual\` first`);
const all = readFileSync(recFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { kind: string });
const captures = all.filter((r) => r.kind === "capture") as CaptureRecord[];

const defects: Defect[] = groupFindings(captures);

// measurements that are not DOM probes become defects here
const manualFile = join(HERE, "defects", "manual.json");
const manual: ManualDefect[] = existsSync(manualFile) ? (JSON.parse(readFileSync(manualFile, "utf8")) as ManualDefect[]) : [];
for (const m of manual) {
  const problems = validateManual(m);
  if (problems.length) throw new Error(`defects/manual.json ${m.id ?? "(no id)"}: ${problems.join("; ")}`);
  defects.push(fromManual(m));
}

for (const r of all as Array<Record<string, any>>) {
  if (r.kind === "spoiler-probe" && r.leaked?.length) {
    defects.push(fromManual({ id: `SPOILER-${r.screen}-${r.viewport}`, title: `Spoiler on ${r.screen}`, severity: "S1", screens: [r.screen], teams: ["BAL"], viewports: [r.viewport], repro: [`open ${r.screen} with partial-reveal through week ${r.revealedWeek}`], expected: "no unrevealed score", actual: `scores visible: ${r.leaked.join(", ")}`, proposedFix: "Read through visibleGames / visibleBracket.", evidence: ["(see records.jsonl)"], status: "open" }));
  }
  if (r.kind === "keyboard") {
    const bad = (r.walk.stops as Array<{ visibleRing: boolean; sig: string; name: string }>).filter((s) => !s.visibleRing);
    if (bad.length) defects.push(fromManual({ id: `FOCUS-${r.screen}-${r.viewport}`, title: `Focus indicator missing on ${r.screen} (${bad.length} stops)`, severity: "S2", screens: [r.screen], teams: [r.team], viewports: [r.viewport], repro: [`Tab through ${r.screen} at ${r.viewport}px`], expected: "visible focus ring on every stop", actual: bad.slice(0, 5).map((b) => `${b.sig} "${b.name}"`).join("; "), proposedFix: "Add a :focus-visible outline.", evidence: ["(see records.jsonl)"], status: "open" }));
  }
}

const run = existsSync(join(OUT_DIR, "run.json")) ? (JSON.parse(readFileSync(join(OUT_DIR, "run.json"), "utf8")) as { gitHead?: string; masterSha?: string | null; scope?: { narrowed: boolean } }) : {};
const md = renderMarkdown(defects, {
  sha: run.masterSha ?? run.gitHead ?? null,
  generatedAt: new Date().toISOString(),
  narrowed: run.scope?.narrowed ?? false,
  captured: captures.filter((c) => c.status === "captured").length,
  redirected: captures.filter((c) => c.status === "redirected").length,
  errors: captures.filter((c) => c.status === "error").length,
});
writeFileSync(join(OUT_DIR, "defect-register.json"), JSON.stringify(defects, null, 2));
writeFileSync(join(OUT_DIR, "DEFECT_REGISTER.md"), md);
console.log(`register: ${defects.length} defect groups from ${captures.length} captures -> ${join(OUT_DIR, "DEFECT_REGISTER.md")}`);
