/**
 * The baseline capture: every catalogued screen at every viewport for the primary franchise, and the palette-sweep
 * screens for every other franchise. Each capture loads the real screen from a league the game played into place, runs
 * the in-page probes (overflow, clipping, targets, names, headings, contrast), takes a full-page screenshot and appends
 * a record. Hard findings are soft assertions: the run lists them all and then fails, so after remediation this is the
 * regression gate; before it, it is the measurement.
 *
 * A route the stage machine redirects away from is recorded "redirected" and NOT counted as captured.
 */
import { acceptedBy } from "../support/known-exceptions.ts";
import { HARD_RULES } from "../support/probes.ts";
import { PRIMARY_TEAM, TEAMS, VIEWPORTS, runScope } from "../support/matrix.ts";
import { SCREENS } from "../support/screens.ts";
import { expect, test } from "../support/audit-test.ts";

const scope = runScope();

for (const team of TEAMS.filter((t) => scope.teams.includes(t.code))) {
  for (const cond of scope.conditions) {
    for (const vp of VIEWPORTS.filter((v) => scope.viewports.includes(v.id))) {
      const screens = SCREENS.filter((s) => s.fixture !== null || s.id === "setup")
        .filter((s) => team.code === PRIMARY_TEAM || s.palette)
        .filter((s) => !scope.screens || scope.screens.includes(s.id));
      for (const screen of screens) {
        test.describe(`${team.code} @${vp.id} [${cond}]`, () => {
          test.use({ team: team.code, fixtureName: screen.fixture, viewportId: vp.id, conditionId: cond });
          test(`${screen.id}`, async ({ capture }) => {
            const rec = await capture(screen);
            expect(rec.status, rec.error ?? `${screen.id} did not load`).not.toBe("error");
            if (rec.status === "redirected") {
              test.info().annotations.push({ type: "redirected", description: `${screen.route} -> ${rec.finalUrl}` });
              return;
            }
            const hard = (rec.probe?.findings ?? []).filter((f) => HARD_RULES.has(f.rule) && !acceptedBy(screen.id, f));
            expect.soft(hard.map((f) => `${f.rule} ${f.sig}: ${f.detail}`), "hard findings").toEqual([]);
            expect.soft(rec.consoleErrors, "console errors").toEqual([]);
          });
        });
      }
    }
  }
}
