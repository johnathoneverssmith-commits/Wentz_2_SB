/**
 * Conditions that are not a screenshot: blocked fonts, reduced motion, keyboard-only navigation, long text. Each test
 * records its measurements (kind "keyboard" / "motion" / "fonts") next to the captures, so the register can cite them.
 */
import { appendRecord, expect, test } from "../support/audit-test.ts";
import { runningMotion, walkFocus } from "../support/probes.ts";
import { PRIMARY_TEAM, VIEWPORTS, runScope } from "../support/matrix.ts";
import { screenById } from "../support/screens.ts";

const scope = runScope();
const CORE = ["hub-week-9", "roster", "schedule", "game-day-week-9"] as const;
const vps = VIEWPORTS.filter((v) => scope.viewports.includes(v.id));

test.describe("fonts blocked", () => {
  for (const vp of vps) {
    for (const id of CORE) {
      const screen = screenById(id);
      test.describe(`${id} @${vp.id}`, () => {
        test.use({ team: PRIMARY_TEAM, fixtureName: screen.fixture, viewportId: vp.id, conditionId: "fonts-blocked" });
        test("renders on the fallback faces with nothing sideways, and says so", async ({ capture, blocked }) => {
          const rec = await capture(screen, { label: "fonts" });
          expect(rec.status).toBe("captured");
          // the condition is real: the browser did try for Google Fonts and was refused
          expect(blocked.some((b) => /fonts\.(googleapis|gstatic)\.com/.test(b.url)), "no font request was blocked: the condition is not in force").toBe(true);
          expect(rec.probe!.fonts.loaded, "a web font loaded although fonts are blocked").toEqual([]);
          expect(rec.probe!.fonts.bodyFamily, "body has no generic fallback in its stack").toMatch(/sans-serif|system-ui|serif|monospace/i);
          expect.soft(rec.probe!.findings.filter((f) => f.rule === "overflow-x-document")).toEqual([]);
        });
      });
    }
  }
});

test.describe("wide and monospace fallback faces", () => {
  for (const vpId of ["390", "320"]) {
    if (!scope.viewports.includes(vpId)) continue;
    for (const face of ["wide-fallback", "mono-fallback"]) {
      const screen = screenById("hub-week-9");
      test.describe(`${face} @${vpId}`, () => {
        test.use({ team: PRIMARY_TEAM, fixtureName: screen.fixture, viewportId: vpId, conditionId: face });
        test(`hub holds together`, async ({ capture }) => {
          const rec = await capture(screen, { label: face });
          expect(rec.status).toBe("captured");
          expect.soft(rec.probe!.findings.filter((f) => f.rule === "overflow-x-document" || f.rule === "text-clipped").map((f) => `${f.rule} ${f.sig} ${f.detail}`)).toEqual([]);
        });
      });
    }
  }
});

test.describe("reduced motion", () => {
  for (const id of CORE) {
    const screen = screenById(id);
    test.describe(id, () => {
      test.use({ team: PRIMARY_TEAM, fixtureName: screen.fixture, viewportId: "1280", conditionId: "reduced-motion" });
      test("no infinite or long-running animation under prefers-reduced-motion", async ({ page, capture, team }) => {
        const rec = await capture(screen, { label: "motion" });
        expect(rec.status).toBe("captured");
        await page.waitForTimeout(600);
        const running = await runningMotion(page);
        const offenders = running.filter((a) => a.iterations === "infinite" || a.durationMs > 400);
        appendRecord({ kind: "motion", screen: id, team, mode: "reduce", running, offenders, at: new Date().toISOString() });
        expect.soft(offenders, "animations still running under reduced motion").toEqual([]);
      });
    });
  }
  test.describe("control", () => {
    const screen = screenById("hub-week-9");
    test.use({ team: PRIMARY_TEAM, fixtureName: screen.fixture, viewportId: "1280", conditionId: "baseline" });
    test("records what animates when motion is allowed (so the reduce check can be read against it)", async ({ page, capture, team }) => {
      await capture(screen, { label: "motion-control" });
      await page.waitForTimeout(600);
      const running = await runningMotion(page);
      appendRecord({ kind: "motion", screen: screen.id, team, mode: "no-preference", running, offenders: [], at: new Date().toISOString() });
    });
  });
});

test.describe("keyboard only", () => {
  for (const vp of vps.filter((v) => ["1280", "390"].includes(v.id))) {
    for (const id of CORE) {
      const screen = screenById(id);
      test.describe(`${id} @${vp.id}`, () => {
        test.use({ team: PRIMARY_TEAM, fixtureName: screen.fixture, viewportId: vp.id, conditionId: "reduced-motion" });
        test("tab order reaches controls, each with a visible ring, and never falls out of the page", async ({ page, capture, team }) => {
          const rec = await capture(screen, { label: "keyboard" });
          expect(rec.status).toBe("captured");
          const walk = await walkFocus(page, 80);
          appendRecord({ kind: "keyboard", screen: id, team, viewport: vp.id, walk, at: new Date().toISOString() });
          expect(walk.stops.length, "Tab reached no control at all").toBeGreaterThan(2);
          expect.soft(walk.stops.filter((s) => !s.visibleRing).map((s) => `${s.sig} "${s.name}"`), "stops with no visible focus indicator").toEqual([]);
          expect.soft(walk.stops.filter((s) => !s.inViewport).map((s) => `${s.sig} "${s.name}"`), "stops focused off screen").toEqual([]);
          expect.soft(walk.lostToBody, "focus fell back to <body> mid-walk").toBe(0);
          expect.soft(walk.repeats, "the same control took focus twice in a row").toBe(0);
        });
      });
    }
  }
});

test.describe("long text and dense data", () => {
  for (const vp of vps) {
    for (const id of ["roster", "hub-week-9"] as const) {
      const screen = screenById(id);
      test.describe(`${id} @${vp.id}`, () => {
        test.use({ team: PRIMARY_TEAM, fixtureName: screen.fixture, viewportId: vp.id, conditionId: "baseline", variant: "long-text" });
        test("very long names do not push the page sideways or get cut silently", async ({ capture }) => {
          const rec = await capture(screen);
          expect(rec.status).toBe("captured");
          expect.soft(rec.probe!.findings.filter((f) => ["overflow-x-document", "text-clipped"].includes(f.rule)).map((f) => `${f.rule} ${f.sig} ${f.detail}`)).toEqual([]);
        });
      });
    }
  }
  test.describe("dense table", () => {
    const screen = screenById("player-stats");
    test.use({ team: PRIMARY_TEAM, fixtureName: screen.fixture, viewportId: "390", conditionId: "baseline" });
    test("player statistics at phone width scroll inside the table, not the page", async ({ capture }) => {
      const rec = await capture(screen, { label: "dense" });
      expect(rec.status).toBe("captured");
      expect.soft(rec.probe!.findings.filter((f) => f.rule === "overflow-x-document")).toEqual([]);
    });
  });
});
