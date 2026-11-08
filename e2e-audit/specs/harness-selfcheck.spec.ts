/**
 * The harness checks itself, with no browser: the severity policy and grouping, the manual-entry schema, the matrix,
 * that the team list matches the stadium photos on disk, that the variants never mutate their input, and that no
 * harness file can write into the app, the engine or a league.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { CONDITIONS, TEAMS, VIEWPORTS } from "../support/matrix.ts";
import { fromManual, groupFindings, severityFor, validateManual, type ManualDefect } from "../support/register.ts";
import { KNOWN_EXCEPTIONS } from "../support/known-exceptions.ts";
import { SCREENS } from "../support/screens.ts";
import { applyVariant, leakedScores, secretScores } from "../support/variants.ts";
import type { CaptureRecord } from "../support/audit-test.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("the five required widths and five required franchises are present, exactly", () => {
  expect(VIEWPORTS.map((v) => v.width)).toEqual([1440, 1280, 768, 390, 320]);
  expect(TEAMS.filter((t) => t.required).map((t) => t.code)).toEqual(["BAL", "PIT", "CIN", "CHI", "LV"]);
  expect(Object.keys(CONDITIONS)).toEqual(expect.arrayContaining(["fonts-blocked", "reduced-motion", "baseline"]));
});

test("every audited team exists, and the 'no photo' claims match public/art/stadiums", () => {
  const teams = readFileSync(join(ROOT, "ui-source/src/data/teams.ts"), "utf8");
  const photos = new Set(readdirSync(join(ROOT, "ui-source/public/art/stadiums")).map((f) => f.replace(/\.webp$/, "")));
  for (const t of TEAMS) {
    expect(teams, `${t.code} is not a team`).toContain(`code: "${t.code}"`);
    const claimsNoPhoto = /no (stadium )?photo/i.test(t.why);
    expect(photos.has(t.code), `${t.code}: "${t.why}"`).toBe(!claimsNoPhoto);
  }
  expect(TEAMS.some((t) => /no (stadium )?photo/i.test(t.why)), "no fallback-skyline team in the set").toBe(true);
});

test("screen ids are unique and every fixture they name is one the builder can make", () => {
  expect(new Set(SCREENS.map((s) => s.id)).size).toBe(SCREENS.length);
  const builder = readFileSync(join(ROOT, "e2e/fixtures/build.ts"), "utf8");
  for (const s of SCREENS) if (s.fixture) expect(builder, `${s.id} names fixture ${s.fixture}`).toContain(`name: "${s.fixture}"`);
});

test("severity policy", () => {
  expect(severityFor({ rule: "contrast", sig: "x", detail: "", data: { ratio: 2.1, need: 4.5 } })).toBe("S1");
  expect(severityFor({ rule: "contrast", sig: "x", detail: "", data: { ratio: 3.4, need: 4.5 } })).toBe("S2");
  expect(severityFor({ rule: "contrast", sig: "x", detail: "", data: { ratio: 4.2, need: 4.5 } })).toBe("S3");
  expect(severityFor({ rule: "overflow-x-document", sig: "html", detail: "" })).toBe("S2");
  expect(severityFor({ rule: "target-below-44-touch", sig: "a", detail: "" })).toBe("S3");
  expect(severityFor({ rule: "heading-skip", sig: "h3", detail: "" })).toBe("S4");
});

const rec = (over: Partial<CaptureRecord>, findings: CaptureRecord["probe"] extends infer P ? (P extends { findings: infer F } ? F : never) : never): CaptureRecord => ({
  kind: "capture", screen: "hub", group: "command-center", state: "", team: "BAL", viewport: "320", condition: "baseline", variant: null, fixture: "preseason", route: "/hub", finalUrl: "#/hub", status: "captured",
  screenshot: "BAL/hub__320__baseline.png", consoleErrors: [], fontsServed: 0, at: "", probe: { url: "", h1: [], title: "", doc: { scrollWidth: 0, clientWidth: 0, scrollHeight: 0, innerHeight: 0 }, fonts: { bodyFamily: "", h1Family: null, loaded: [] }, findings, counts: { interactive: 0, textElements: 0, contrastChecked: 0, contrastIndeterminate: 0 } }, ...over,
});

test("one root cause across many screens, teams and widths is one register entry, at the worst severity", () => {
  const f = (ratio: number) => ({ rule: "contrast", sig: "span.gd-kicker", detail: `${ratio}:1`, data: { ratio, need: 4.5 } });
  const records = [rec({ team: "BAL" }, [f(4.1)]), rec({ team: "PIT", screen: "roster", viewport: "1440" }, [f(2.4)]), rec({ team: "CIN", status: "redirected" }, [f(1.2)])];
  const groups = groupFindings(records);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ count: 2, severity: "S1", teams: ["BAL", "PIT"], screens: ["hub", "roster"], id: "V-001" });
  expect(groups[0]!.repro.join("\n")).toContain("AUDIT_TEAMS=BAL");
  expect(groups[0]!.proposedFix).toMatch(/accentText/);
});

test("manual entries must carry reproduction steps, evidence and a fix", () => {
  const ok: ManualDefect = { id: "M-1", title: "t", severity: "S3", screens: ["hub"], teams: ["BAL"], viewports: ["390"], repro: ["a"], expected: "e", actual: "a", proposedFix: "f", evidence: ["BAL/x.png"], status: "open" };
  expect(validateManual(ok)).toEqual([]);
  expect(validateManual({ ...ok, repro: [], evidence: [], proposedFix: "" }).length).toBe(3);
  expect(validateManual({ ...ok, status: "fixed-in-pr" })).toContain("fixed-in-pr needs a pr link");
  expect(fromManual(ok).source).toBe("manual");
});

test("variants change a copy and leave the input string alone", () => {
  const save = JSON.stringify({ version: 1, state: { viewerGmId: "g1", gms: [{ id: "g1", name: "Pat", teamCode: "BAL" }], players: { p1: { name: "Al Smith", nfl_team: "BAL" } }, games: [] } });
  const before = save.slice();
  const long = JSON.parse(applyVariant(save, "long-text")).state;
  expect(long.gms[0].name.length).toBeGreaterThan(30);
  expect(long.players.p1.name).toContain("Featherstonehaugh");
  expect(save).toBe(before);
  const rev = JSON.parse(applyVariant(save, "partial-reveal")).state;
  expect(rev.reveal.regularWeek.g1).toBe(4);
});

test("spoiler probe only flags scores no revealed game shares", () => {
  const games = [
    { played: true, phase: "REG", week: 1, homeScore: 24, awayScore: 17 },
    { played: true, phase: "REG", week: 5, homeScore: 24, awayScore: 17 }, // same pair as a revealed game: not secret
    { played: true, phase: "REG", week: 6, homeScore: 31, awayScore: 10 },
  ];
  const save = JSON.stringify({ state: { games } });
  const { secret, hiddenWeeks } = secretScores(save, 4);
  expect(hiddenWeeks).toEqual([5, 6]);
  expect(secret.sort()).toEqual(["10-31", "31-10"]);
  expect(leakedScores("Final 24–17 and 31 - 10", secret)).toEqual(["31 - 10"]);
  expect(leakedScores("Final 24–17", secret)).toEqual([]);
});

test("no harness file writes anywhere but its own output, or touches game code", () => {
  const dir = join(ROOT, "e2e-audit");
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", "audit-output", "test-results"].includes(e.name)) continue;
      const p = join(d, e.name);
      e.isDirectory() ? walk(p) : /\.ts$/.test(e.name) && files.push(p);
    }
  };
  walk(dir);
  for (const f of files) {
    if (f.endsWith("harness-selfcheck.spec.ts")) continue;
    const text = readFileSync(f, "utf8");
    const where = relative(ROOT, f);
    // imports from the app / engine / server are forbidden: the harness drives the built UI in a browser only
    expect(text, `${where} imports app code`).not.toMatch(/from ["'](?:\.\.\/)+(?:ui-source|src|online|server|arcade)\//);
    // writes are confined: only the output directory and temp dirs
    for (const m of text.matchAll(/(?:writeFileSync|appendFileSync|mkdirSync|rmSync)\(([^,)]+)/g)) {
      expect(m[1], `${where}: write target`).toMatch(/OUT_DIR|CACHE|bodyFile|typeFile|d\b|dirs|join\(OUT_DIR|dir\b|recFile|join\(CACHE/);
    }
  }
});

test("every known exception cites where it was decided", () => {
  for (const e of KNOWN_EXCEPTIONS) {
    expect(e.cite.trim().length, `${e.rule} on ${String(e.screen)} has no citation`).toBeGreaterThan(5);
    expect(e.reason.trim().length).toBeGreaterThan(20);
  }
});
