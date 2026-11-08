/**
 * The defect register: structure, severity policy, and the grouping that turns hundreds of measurements into a short
 * list of root causes. Pure functions over plain data, so the policy is unit-tested (specs/harness-selfcheck.spec.ts).
 *
 * Severity:
 *   S1 blocker  a player cannot complete the screen, or sees something they must not (a spoiler), or content is unreadable
 *   S2 high     fails WCAG AA in a way that blocks some players (contrast, names, focus, sideways scroll, targets < 24 px)
 *   S3 medium   visibly wrong or below the product's own bar (touch targets < 44, clipped text, missing landmark)
 *   S4 low      polish and advisories
 *   info        recorded for coverage; not a defect (a redirected route)
 */
import type { CaptureRecord } from "./audit-test.ts";
import type { Finding } from "./probes.ts";
import { acceptedBy } from "./known-exceptions.ts";

export type Severity = "S1" | "S2" | "S3" | "S4";
export const SEVERITIES: readonly Severity[] = ["S1", "S2", "S3", "S4"];

export interface ManualDefect {
  id: string;
  title: string;
  severity: Severity;
  screens: string[];
  teams: string[];
  viewports: string[];
  conditions?: string[];
  /** Exact steps, starting from a fixture, that another person can follow. */
  repro: string[];
  expected: string;
  actual: string;
  proposedFix: string;
  /** Screenshot paths relative to the audit output directory. */
  evidence: string[];
  status: "open" | "fixed-in-pr" | "wont-fix" | "needs-design";
  pr?: string | undefined;
}

export interface Defect {
  id: string;
  source: "probe" | "manual";
  title: string;
  severity: Severity;
  rule: string;
  sig: string;
  count: number;
  screens: string[];
  teams: string[];
  viewports: string[];
  conditions: string[];
  repro: string[];
  expected: string;
  actual: string;
  proposedFix: string;
  evidence: string[];
  status: ManualDefect["status"];
  pr?: string | undefined;
}

export function severityFor(f: Finding): Severity {
  switch (f.rule) {
    case "spoiler":
      return "S1";
    case "contrast": {
      const r = Number(f.data?.ratio ?? 4.5);
      return r < 3 ? "S1" : r < (Number(f.data?.need ?? 4.5) * 0.85) ? "S2" : "S3";
    }
    case "overflow-x-document":
    case "no-accessible-name":
    case "target-below-24":
    case "focus-invisible":
    case "focus-lost":
      return "S2";
    case "overflow-x-element":
    case "h1-count":
    case "text-clipped":
    case "no-main-landmark":
    case "img-no-alt":
    case "target-below-44-touch":
    case "console-error":
      return "S3";
    default:
      return "S4";
  }
}

const FIX: Record<string, { expected: string; fix: string }> = {
  contrast: { expected: "text meets 4.5:1 (3:1 for large text) against its actual background", fix: "Use the accent's text variant (`accentText`, darkened until it reads on white) for text, and keep the raw accent for fills and rules only; check on the team palette that failed." },
  "overflow-x-document": { expected: "no sideways page scroll at any width from 320", fix: "Find the widest child (see the overflow-x-element groups): give it `min-width:0`, `max-width:100%`, `overflow-wrap:anywhere`, or move wide tables into their own `overflow-x:auto` scroller." },
  "overflow-x-element": { expected: "every element fits inside the viewport or inside its own scroller", fix: "Let the flex/grid child shrink (`min-width:0`), wrap long words, or put the wide content in a named scroll region with a visible affordance." },
  "target-below-24": { expected: "interactive targets are at least 24x24 CSS px (WCAG 2.2 AA 2.5.8)", fix: "Add padding or `min-height:24px` (44px on touch widths) to the control, not to its label." },
  "target-below-44-touch": { expected: "touch targets are at least 44x44 CSS px at touch widths (the product bar)", fix: "Raise `min-height`/`min-width` to 44px under the touch breakpoint, or enlarge the hit area with padding." },
  "no-accessible-name": { expected: "every control has an accessible name", fix: "Add visible text, or `aria-label` for icon-only controls." },
  "h1-count": { expected: "exactly one visible h1 per screen, naming the screen", fix: "Make the screen's masthead title the only h1; demote others to h2." },
  "heading-skip": { expected: "heading levels descend one at a time", fix: "Use the right level for outline, and style it with a class instead." },
  "text-clipped": { expected: "text is never cut silently", fix: "Allow wrapping (`overflow-wrap:anywhere`) or use an ellipsis with the full text in `title`/`aria-label`." },
  "text-truncated-no-title": { expected: "a truncated label offers its full text", fix: "Add `title` (or an accessible tooltip) carrying the full text." },
  "no-main-landmark": { expected: "one <main> landmark", fix: "Render the screen body inside <main>." },
  "img-no-alt": { expected: "images have alt text (empty for decoration)", fix: "Add `alt` (empty string when decorative)." },
  "focus-invisible": { expected: "focused controls draw a visible indicator", fix: "Add a `:focus-visible` outline (2px, offset 2px) that contrasts with both the page and the control." },
  "focus-lost": { expected: "focus never falls back to <body> while tabbing", fix: "Find the element that removes itself on focus or blur and keep focus on its successor." },
  spoiler: { expected: "no result outside the GM's revealed weeks appears anywhere", fix: "Route the data through `visibleGames` / `visibleBracket`; never read `state.games` or `state.bracket` directly." },
};

export function reproFor(rec: Pick<CaptureRecord, "screen" | "team" | "viewport" | "condition" | "fixture" | "route">, f: Finding): string[] {
  return [
    `npm run audit:visual -- -g "${rec.screen}" with AUDIT_TEAMS=${rec.team} AUDIT_VIEWPORTS=${rec.viewport} AUDIT_SCREENS=${rec.screen} AUDIT_CONDITIONS=${rec.condition}`,
    `or by hand: play a league as ${rec.team} to the "${rec.fixture ?? "no league"}" stage (e2e/fixtures/build.ts --team ${rec.team}), open #${rec.route} at ${rec.viewport}px wide`,
    `measure: ${f.rule} on ${f.sig}${f.text ? ` ("${f.text}")` : ""}: ${f.detail}`,
  ];
}

/** Groups probe findings by root cause (rule + element signature) across screens, teams and viewports. */
export function groupFindings(records: readonly CaptureRecord[]): Defect[] {
  const groups = new Map<string, Defect & { _example: { rec: CaptureRecord; f: Finding } }>();
  for (const rec of records) {
    if (rec.kind !== "capture" || rec.status !== "captured" || !rec.probe) continue;
    for (const f of rec.probe.findings) {
      if (acceptedBy(rec.screen, f)) continue; // a documented, deliberate deviation
      const key = `${f.rule}|${f.sig}`;
      const sev = severityFor(f);
      let g = groups.get(key);
      if (!g) {
        const fx = FIX[f.rule];
        g = {
          id: "", source: "probe", title: `${f.rule}: ${f.sig}`, severity: sev, rule: f.rule, sig: f.sig, count: 0, screens: [], teams: [], viewports: [], conditions: [],
          repro: reproFor(rec, f), expected: fx?.expected ?? "", actual: f.detail, proposedFix: fx?.fix ?? "Investigate the measurement.", evidence: [], status: "open", _example: { rec, f },
        };
        groups.set(key, g);
      }
      g.count++;
      if (SEVERITIES.indexOf(sev) < SEVERITIES.indexOf(g.severity)) g.severity = sev;
      for (const [list, v] of [[g.screens, rec.screen], [g.teams, rec.team], [g.viewports, rec.viewport], [g.conditions, rec.condition]] as const) if (!list.includes(v)) list.push(v);
      if (rec.screenshot && g.evidence.length < 4 && !g.evidence.includes(rec.screenshot)) g.evidence.push(rec.screenshot);
    }
  }
  const out = [...groups.values()].map(({ _example, ...d }) => d as Defect);
  out.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.count - a.count || a.title.localeCompare(b.title));
  out.forEach((d, i) => (d.id = `V-${String(i + 1).padStart(3, "0")}`));
  return out;
}

export function fromManual(m: ManualDefect): Defect {
  return { id: m.id, source: "manual", title: m.title, severity: m.severity, rule: "manual", sig: "", count: 1, screens: m.screens, teams: m.teams, viewports: m.viewports, conditions: m.conditions ?? [], repro: m.repro, expected: m.expected, actual: m.actual, proposedFix: m.proposedFix, evidence: m.evidence, status: m.status, pr: m.pr };
}

/** Required fields of a manual entry; returns the problems, empty when the entry is complete. */
export function validateManual(m: Partial<ManualDefect>): string[] {
  const p: string[] = [];
  for (const k of ["id", "title", "expected", "actual", "proposedFix"] as const) if (!m[k] || !String(m[k]).trim()) p.push(`${k} is required`);
  if (!m.severity || !SEVERITIES.includes(m.severity)) p.push("severity must be S1..S4");
  for (const k of ["screens", "teams", "viewports", "repro", "evidence"] as const) if (!Array.isArray(m[k]) || (m[k] as unknown[]).length === 0) p.push(`${k} needs at least one entry`);
  if (m.status && !["open", "fixed-in-pr", "wont-fix", "needs-design"].includes(m.status)) p.push("status is not recognised");
  if (m.status === "fixed-in-pr" && !m.pr) p.push("fixed-in-pr needs a pr link");
  return p;
}

export function renderMarkdown(defects: readonly Defect[], meta: { sha: string | null; generatedAt: string; narrowed: boolean; captured: number; redirected: number; errors: number }): string {
  const lines: string[] = [];
  lines.push("# Visual & accessibility defect register", "");
  lines.push(`Generated ${meta.generatedAt} from ${meta.captured} captures (${meta.redirected} redirected, ${meta.errors} errored). Commit: \`${meta.sha ?? "unknown"}\`.`);
  if (meta.narrowed) lines.push("", "> **NARROWED RUN.** Teams, viewports, screens or conditions were limited. This is a smoke run, not the baseline.");
  lines.push("", "| Severity | Open | Total |", "|---|---|---|");
  for (const s of SEVERITIES) lines.push(`| ${s} | ${defects.filter((d) => d.severity === s && d.status === "open").length} | ${defects.filter((d) => d.severity === s).length} |`);
  for (const s of SEVERITIES) {
    const ds = defects.filter((d) => d.severity === s);
    if (!ds.length) continue;
    lines.push("", `## ${s}`);
    for (const d of ds) {
      lines.push("", `### ${d.id} — ${d.title}`, "", `- **Status:** ${d.status}${d.pr ? ` (${d.pr})` : ""}`, `- **Seen:** ${d.count}× on ${d.screens.join(", ")}; teams ${d.teams.join(", ")}; viewports ${d.viewports.join(", ")}${d.conditions.length ? `; conditions ${d.conditions.join(", ")}` : ""}`);
      lines.push(`- **Expected:** ${d.expected}`, `- **Actual:** ${d.actual}`, "- **Reproduce:**", ...d.repro.map((r, i) => `  ${i + 1}. ${r}`), `- **Proposed fix:** ${d.proposedFix}`);
      if (d.evidence.length) lines.push("- **Evidence:** " + d.evidence.map((e) => `\`shots/${e}\``).join(", "));
    }
  }
  return lines.join("\n") + "\n";
}
