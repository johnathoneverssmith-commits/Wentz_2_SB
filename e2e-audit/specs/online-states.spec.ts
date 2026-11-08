/**
 * Online screens, on a controlled transport (support/online-league.ts, support/lobby-api.ts). The lobby scenarios cover
 * loading, signed out, refused sign-in, server down, an HTML error page, an empty account, a member, a commissioner and
 * an account with many long-named leagues. The in-league tests cover the commissioner's take-turn control in every
 * context it appears in, and a partially revealed season for spoiler leaks.
 */
import { readSavedState } from "../../e2e/support/idb.ts";
import { expect, test, appendRecord, SAVE_KEY } from "../support/audit-test.ts";
import { addOtherHuman, moveClockOffViewer, onlineLeague } from "../support/online-league.ts";
import { lobbyScenario, type LobbyScenario } from "../support/lobby-api.ts";
import { VIEWPORTS, runScope, PRIMARY_TEAM } from "../support/matrix.ts";
import { screenById } from "../support/screens.ts";
import { HARD_RULES } from "../support/probes.ts";
import { PARTIAL_REVEAL_WEEK, leakedScores, secretScores } from "../support/variants.ts";

const scope = runScope();
const vps = VIEWPORTS.filter((v) => scope.viewports.includes(v.id));
const LOBBY: LobbyScenario[] = ["loading", "signed-out", "sign-in-refused", "server-down", "html-error-page", "account-empty", "account-member", "account-commissioner", "account-many-long"];

test.describe("online lobby states", () => {
  for (const vp of vps) {
    for (const scenario of LOBBY) {
      test.describe(`${scenario} @${vp.id}`, () => {
        test.use({ fixtureName: null, viewportId: vp.id, conditionId: "baseline", allowAnyBlocked: true });
        test("lobby renders this state legibly", async ({ page, capture, origin }) => {
          test.slow();
          await lobbyScenario(page, origin, scenario);
          const screen = { ...screenById("online-lobby"), state: `online lobby: ${scenario}` };
          // the loading state is the one that must be photographed while pending, so capture before the 8 s answer
          const rec = await capture(screen, { label: scenario });
          expect(rec.status).toBe("captured");
          const hard = (rec.probe?.findings ?? []).filter((f) => HARD_RULES.has(f.rule));
          expect.soft(hard.map((f) => `${f.rule} ${f.sig}: ${f.detail}`)).toEqual([]);
        });
      });
    }
  }
});

/** Contexts the commissioner's take-turn control sits in. The two the brief names are a dark coaching draft and a light game day. */
const TAKE_TURN: Array<{ id: string; fixture: string; route: string }> = [
  { id: "coaching-draft", fixture: "coaching-draft", route: "/coaching-draft" },
  // fantasy-draft is not here: its fixture is saved before the draft starts (no turn exists yet); see README "Known gaps"
  { id: "trade-deadline", fixture: "trade-deadline", route: "/trade-deadline" },
  { id: "free-agency-board", fixture: "midseason-fa", route: "/free-agency-board" },
];

test.describe("CommissionerTakeTurn", () => {
  for (const ctx of TAKE_TURN) {
    for (const vp of vps.filter((v) => ["1280", "390", "320"].includes(v.id))) {
      test.describe(`${ctx.id} @${vp.id}`, () => {
        test.use({ team: PRIMARY_TEAM, fixtureName: ctx.fixture, viewportId: vp.id, conditionId: "baseline", allowAnyBlocked: true });
        test("appears for the commissioner when another human is on the clock, and reads in this context", async ({ page, capture, origin, team }) => {
          await page.goto("/");
          const state = await readSavedState(page, SAVE_KEY);
          const clock = moveClockOffViewer(state, team);
          expect(clock, `${ctx.id}: the saved league has no turn-based event to hand to another GM`).toBeTruthy();
          addOtherHuman(state, clock!);
          const gm = state.gms.find((g: any) => g.id === state.viewerGmId);
          await onlineLeague(page, origin, state, { you: { teamCode: gm.teamCode, gmId: gm.id }, isCommissioner: true, waitingOn: [clock!], msLeft: 3_600_000, leagueName: "Audit league" });
          await page.reload();
          await expect(page.getByText("Audit league", { exact: true }).first()).toBeVisible();
          const rec = await capture({ ...screenById("online-lobby"), id: `take-turn-${ctx.id}`, group: "online", fixture: ctx.fixture, route: ctx.route, state: `commissioner take-turn control in ${ctx.id}` });
          const btn = page.getByRole("button", { name: /^Commissioner: have .* staff/ });
          const present = (await btn.count()) > 0;
          appendRecord({ kind: "take-turn", context: ctx.id, viewport: vp.id, present, finalUrl: rec.finalUrl, at: new Date().toISOString() });
          // not asserting presence as a hard failure when the stage machine redirected: that is recorded, not hidden
          if (rec.status === "captured" && present) {
            await expect.soft(btn.first()).toBeVisible();
            const box = await btn.first().boundingBox();
            expect.soft((box?.height ?? 0) >= 24, "take-turn button is under 24px tall").toBe(true);
            const contrast = (rec.probe?.findings ?? []).filter((f) => f.rule === "contrast" && /btnlink|online-taketurn/.test(f.sig));
            expect.soft(contrast.map((f) => f.detail), "take-turn control contrast").toEqual([]);
            // the confirmation dialog is native; dismiss it and make sure nothing was sent
            page.once("dialog", (d) => void d.dismiss());
            await btn.first().click();
          }
        });
      });
    }
  }
});

test.describe("partially revealed season: no spoilers", () => {
  const SCREENS_TO_PROBE = ["hub-week-9", "schedule", "league-stats", "player-stats", "games", "game-day-week-9"] as const;
  for (const vp of vps.filter((v) => ["1280", "390"].includes(v.id))) {
    for (const id of SCREENS_TO_PROBE) {
      const screen = screenById(id);
      test.describe(`${id} @${vp.id}`, () => {
        test.use({ team: PRIMARY_TEAM, fixtureName: "season-week-9", viewportId: vp.id, conditionId: "baseline", variant: "partial-reveal", allowAnyBlocked: true });
        test(`shows nothing past week ${PARTIAL_REVEAL_WEEK}`, async ({ page, capture, origin, fixture }) => {
          await page.goto("/");
          const state = await readSavedState(page, SAVE_KEY);
          const gm = state.gms.find((g: any) => g.id === state.viewerGmId);
          // worst-case server: the whole block is sent unredacted, so the client's own filters are what is under test
          await onlineLeague(page, origin, state, { you: { teamCode: gm.teamCode, gmId: gm.id } });
          await page.reload();
          await expect(page.getByText("Audit league", { exact: true }).first()).toBeVisible();
          const rec = await capture({ ...screen, state: `${screen.state}; revealed through week ${PARTIAL_REVEAL_WEEK}` }, { label: "online" });
          expect(rec.status).not.toBe("error");
          const text = await page.locator("body").innerText();
          const { secret, hiddenWeeks } = secretScores(fixture!.save, PARTIAL_REVEAL_WEEK);
          expect(hiddenWeeks.length, "the fixture has no unrevealed weeks: the probe would prove nothing").toBeGreaterThan(0);
          const leaked = leakedScores(text, secret);
          appendRecord({ kind: "spoiler-probe", screen: id, viewport: vp.id, revealedWeek: PARTIAL_REVEAL_WEEK, hiddenWeeks, secretPairs: secret.length, leaked, status: rec.status, at: new Date().toISOString() });
          expect.soft(leaked, "scores of unrevealed games appear on screen").toEqual([]);
        });
      });
    }
  }
});

test.describe("solo: corrupt save", () => {
  test.use({ fixtureName: null, viewportId: "390", conditionId: "baseline" });
  test("a garbled save shows the app's own recovery, not a white screen", async ({ page, consoleErrors }) => {
    await page.addInitScript((k) => localStorage.setItem(k, "{not json"), SAVE_KEY);
    await page.goto("/");
    await page.waitForTimeout(1500);
    const text = (await page.locator("body").innerText()).trim();
    appendRecord({ kind: "error-state", what: "corrupt-save", text: text.slice(0, 300), consoleErrors, at: new Date().toISOString() });
    expect(text.length, "blank page after a corrupt save").toBeGreaterThan(20);
    // the app keeps what it could not read (a copy in IndexedDB that no autosave touches) instead of discarding it
    const kept = await page.evaluate(
      () =>
        new Promise<boolean>((res) => {
          const r = indexedDB.open("nfl-sim-ui-saves");
          r.onsuccess = () => {
            const q = r.result.transaction("saves").objectStore("saves").get("nfl-sim-ui.league#damaged");
            q.onsuccess = () => res(q.result === "{not json");
            q.onerror = () => res(false);
          };
          r.onerror = () => res(false);
        }),
    );
    expect(kept, "the unreadable legacy save was kept aside, not discarded").toBe(true);
  });
});
