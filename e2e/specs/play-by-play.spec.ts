import type { Page } from "@playwright/test";

import { expect, test } from "../support/test.ts";

/**
 * Play-by-play access, game history, fan reactions and portraits, through the screens.
 * Solo, in-process Mock sim (the adapter is unreachable): so no game has a stored play trace,
 * which is the shipped solo case. The screens must say that honestly and still show what was kept.
 */
const SHOTS = process.env.E2E_SHOTS_DIR ?? "";
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const ready = (page: Page) => page.getByRole("button", { name: "Ready for Game Day" });
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });

test.use({ fixtureName: "season-week-1" });

test("play two weeks, then reach every game's play-by-play, history, fans and portraits", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page).toHaveURL(/#\/hub$/);
  // only preseason games exist so far: the fans react to the latest one, lightly
  await expect(page.getByTestId("fan-reactions").locator("li").first()).toBeVisible();

  for (const week of [1, 2]) {
    await ready(page).click();
    await expect(page).toHaveURL(/#\/game-day$/);
    await cont(page).click();
    await expect(page).toHaveURL(/#\/hub$/);
    void week;
  }

  // fans: 4-6 posts, the same after a reload
  const fans = page.getByTestId("fan-reactions").locator("li");
  await expect(fans.first()).toBeVisible();
  const count = await fans.count();
  expect(count).toBeGreaterThanOrEqual(4);
  expect(count).toBeLessThanOrEqual(6);
  const before = await fans.allInnerTexts();
  await shot(page, "hub-fans-desktop");
  await page.reload();
  await expect(fans.first()).toBeVisible();
  expect(await fans.allInnerTexts()).toEqual(before);

  // hub -> Watch Play-by-Play
  await page.getByRole("button", { name: "Watch Play-by-Play" }).click();
  await expect(page).toHaveURL(/#\/watch\//);
  await expect(page.getByTestId("pbp-summary").or(page.getByTestId("pbp-log"))).toBeVisible();
  await shot(page, "watch-desktop");

  // game history lists both games, newest first, each reachable
  await page.goto("/#/games");
  const rows = page.getByTestId("history-row");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThanOrEqual(2);
  await expect(rows.first()).toContainText("Week 2");
  await shot(page, "history-desktop");
  await rows.first().getByRole("button", { name: /Scoring summary|Play-by-play|Details/ }).click();
  await expect(page).toHaveURL(/#\/watch\//);

  // the schedule links to it too
  await page.goto("/#/schedule");
  await page.locator("main select").selectOption({ label: "Week 2" });
  await expect(page.getByRole("button", { name: /^Play-by-play, / }).first()).toBeVisible();

  // portraits: the roster screen and the decision screens show no faces, by design (the generator's
  // one-face-per-player guarantee is unit-tested in components/PlayerPortrait.test.ts)
  await page.goto("/#/roster");
  await expect(page.locator(".roster-list .prow").first()).toBeVisible();
  await expect(page.locator("svg.player-portrait")).toHaveCount(0);
  await page.goto("/#/free-agency");
  await expect(page.locator(".decision-gd .fa-list .prow").first()).toBeVisible();
  await expect(page.locator("svg.player-portrait")).toHaveCount(0);
  await shot(page, "market-no-portraits-desktop");

  // mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/hub");
  await expect(fans.first()).toBeVisible();
  await shot(page, "hub-fans-mobile");
  await page.goto("/#/games");
  await shot(page, "history-mobile");
  await page.getByTestId("history-row").first().getByRole("button").last().click();
  await shot(page, "watch-mobile");
});

/**
 * A game that does carry a real engine trace (the adapter case): the transcript browses by quarter,
 * filters to scoring/turnovers/big plays, and survives a reload. The trace is the engine's own
 * (`broadcastGame`); the saved game's score is set to the trace's final so the two agree.
 */
test("a game with a recorded trace browses quarter by quarter", async ({ page }) => {
  test.setTimeout(120_000);
  const { broadcastGame } = await import("../../src/engine/broadcast.ts");
  await page.goto("/");
  await expect(page).toHaveURL(/#\/hub$/);
  await ready(page).click();
  await expect(page).toHaveURL(/#\/game-day$/);
  await cont(page).click();
  await expect(page).toHaveURL(/#\/hub$/);

  const target = await page.evaluate(() => {
    const doc = JSON.parse(localStorage.getItem("nfl-sim-ui.league")!);
    const s = doc.state;
    const me = s.gms.find((g: any) => g.id === s.viewerGmId).teamCode;
    const g = s.games.filter((x: any) => x.phase === "REG" && (x.homeTeam === me || x.awayTeam === me)).pop();
    return { id: g.id as string, home: g.homeTeam as string, away: g.awayTeam as string };
  });
  // the committed pool's real rosters (no generated pool is needed)
  const { Roster } = await import("../../src/engine/roster.ts");
  const pool = (await import("../../ui-source/src/data/pool-2026.json", { with: { type: "json" } })).default as unknown as Array<{ nfl_team: string }>;
  const squad = (code: string) => new Roster(code === "LAR" ? "LA" : code, pool.filter((p) => p.nfl_team === code) as never);
  const bc = broadcastGame(20260101, target.home === "LAR" ? "LA" : target.home, target.away === "LAR" ? "LA" : target.away, { homeRoster: squad(target.home), awayRoster: squad(target.away) });
  await page.evaluate(({ id, bc }) => {
    const doc = JSON.parse(localStorage.getItem("nfl-sim-ui.league")!);
    const g = doc.state.games.find((x: any) => x.id === id);
    g.broadcast = bc;
    g.homeScore = bc.finalScore[0];
    g.awayScore = bc.finalScore[1];
    localStorage.setItem("nfl-sim-ui.league", JSON.stringify(doc));
  }, { id: target.id, bc: JSON.parse(JSON.stringify(bc)) });

  await page.goto(`/#/watch/${target.id}`);
  await page.reload();
  await page.getByRole("button", { name: /Show full transcript/ }).click();
  const log = page.getByTestId("pbp-log");
  await expect(log).toBeVisible();
  const q1 = await log.getByTestId("pbp-drive").count();
  expect(q1).toBeGreaterThan(0);
  await log.getByRole("tab", { name: "Q2" }).click();
  await expect(log.getByRole("tab", { name: "Q2" })).toHaveAttribute("aria-selected", "true");
  await log.getByRole("tab", { name: "Full game" }).click();
  const all = await log.getByTestId("pbp-drive").count();
  expect(all).toBe(bc.drives.length);
  await log.getByLabel(/Scoring, turnovers/).check();
  expect(await log.getByTestId("pbp-drive").count()).toBeLessThan(all);
  await shot(page, "play-by-play-log-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "play-by-play-log-mobile");
});
