import type { Page } from "@playwright/test";

import { AFC, authoritativeSeeding, teamIdentity, expectSeasonConsistent, gamesDigest, NFC, readSeason, recordText, regGames, scheduledIn, type Season } from "../support/season.ts";
import { expect, test } from "../support/test.ts";

/**
 * The regular season, played through the screens a player uses.
 *
 * A week is: "Ready for Game Day" on the hub (the league plays the whole slate), the Game Day screen with the results,
 * and "Continue" (which steps the week, or the stage). The saves are moments of one playthrough of the game's own
 * stage machine (e2e/fixtures/build.ts): the opening week, the last week before the trade deadline, two weeks from the
 * playoffs. Nothing is set by hand and no result is made up: the games are whatever the game simulated.
 *
 * What is checked, after every week, against the saved league alone (`expectSeasonConsistent`): each scheduled game is
 * on the books exactly once and nothing else is; no team plays twice in a week; every record and point total is what
 * the games add up to; the ranks agree with the records. And on the screens: the hub's record, the standings table, the
 * schedule's final scores and the bracket say what the save says.
 */
const HUB = /#\/hub$/;
const GAME_DAY = /#\/game-day$/;
const ready = (page: Page) => page.getByRole("button", { name: "Ready for Game Day" });
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
/** The value beside a stat's label (the labels are paragraphs; a table header can read the same). */
const statBeside = (page: Page, label: string) => page.locator("p").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::*[1]");
const hubRecord = (page: Page) => statBeside(page, "Record");

/** Plays one week through the hub and the Game Day screen, checking the books before, in between. Leaves it on Game Day. */
async function playToGameDay(page: Page, week: number): Promise<{ before: Season; results: Season }> {
  const before = await readSeason(page);
  expect(before).toMatchObject({ stage: "regularSeason", week, pending: null });
  await expect(page).toHaveURL(HUB);
  await expect(hubRecord(page)).toHaveText(recordText(before.teams[before.me]!));
  await ready(page).click();
  await expect(page).toHaveURL(GAME_DAY);
  await expect.poll(async () => (await readSeason(page)).pending?.week, { message: `week ${week}'s slate was saved` }).toBe(week);
  const results = await readSeason(page);

  // exactly the week's scheduled games were played, once, and what is held for the Game Day screen is those games
  const scheduled = scheduledIn(results, week);
  const played = regGames(results, week);
  expect(played).toHaveLength(scheduled.length);
  expect(results.pending).toMatchObject({ phase: "REG", week });
  expect(results.pending!.gameIds.slice().sort()).toEqual(played.map((g) => g.id).sort());
  expect(results.games.length, "the books grew by exactly this week's games").toBe(before.games.length + scheduled.length);
  // nothing from before was touched
  expect(gamesDigest(results).startsWith(gamesDigest(before))).toBe(true);
  expect(results).toMatchObject({ stage: "regularSeason", week });
  expectSeasonConsistent(results, week);

  await expect(page.getByText(`Week ${week} · results are in`)).toBeVisible();
  await expect(page.getByText(/^final$/i).first()).toBeVisible();
  return { before, results };
}

/** Presses Continue on Game Day and waits for the league to be at the given stage and week. */
async function continueTo(page: Page, stage: string, week: number): Promise<Season> {
  await cont(page).click();
  await expect.poll(async () => { const s = await readSeason(page); return `${s.stage}:${s.week}`; }, { message: `the league moved to ${stage}, week ${week}` }).toBe(`${stage}:${week}`);
  return readSeason(page);
}

/** Each rendered team keeps its identity attached to its seed, record and points. */
async function standingsOnScreen(page: Page) {
  await page.getByRole("tab", { name: /League Standings/ }).or(page.getByRole("button", { name: /League Standings/ })).first().click();
  const rows = page.locator("main table:visible tbody tr");
  await expect(rows.first()).toBeVisible();
  return rows.evaluateAll((trs) => trs.map((tr) => {
    const c = Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent ?? "").trim());
    return { seed: c[0], name: c[1], w: Number(c[2]), l: Number(c[3]), t: Number(c[4]), pf: Number(c[5]), pa: Number(c[6]), pd: Number(c[7]) };
  }));
}

/** Wild Card team rows, including the bye, in actual matchup order. Names and seeds stay attached to each record. */
async function bracketOnScreen(page: Page) {
  const column = page.locator(".panel.open .bracket-col").first();
  await expect(column).toBeVisible();
  return column.evaluate((col) => Array.from(col.querySelectorAll("span"))
    .filter((el) => el.children.length === 0 && /^\d+ OVR · \d+-\d+(?:-\d+)?$/.test((el.textContent ?? "").trim()))
    .map((el) => {
      const name = el.parentElement!;
      const row = name.parentElement!;
      return { label: name.querySelector("span")?.textContent?.trim(), seed: Number(row.querySelector(".oswald")?.textContent), record: el.textContent!.trim().split("OVR · ")[1] };
    }));
}

/** The schedule screen's final scores for a week, as "home|away|homeScore-awayScore", from what is on the screen. */
async function scheduleOnScreen(page: Page, week: number): Promise<string[]> {
  await page.locator("main select").selectOption({ label: `Week ${week}` });
  await expect(statBeside(page, "Viewing")).toHaveText(`Week ${week}`);
  const lines = (await page.locator("main").innerText()).split("\n").map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  lines.forEach((l, i) => {
    if (l !== "Final") return;
    const score = /^(\d+)\s*[–-]\s*(\d+)$/.exec(lines[i - 1] ?? "");
    out.push(`${lines[i - 4]}|${lines[i + 1]}|${score?.[1]}-${score?.[2]}`);
  });
  return out.sort();
}

const scoresOf = (s: Season, week: number) => regGames(s, week).map((g) => `${g.home}|${g.away}|${g.homeScore}-${g.awayScore}`).sort();

test.describe("weeks of the regular season", () => {
  test.use({ fixtureName: "season-week-1" });

  test("three weeks from the opener: each game is played once, the standings add up, and the screens agree with the books", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page).toHaveURL(HUB);
    const start = await readSeason(page);
    expect(regGames(start)).toHaveLength(0);
    expect(Object.values(start.teams).every((t) => t.w + t.l + t.t === 0)).toBe(true);
    expect(start.schedule.length, "a full schedule: 17 games each, 272 in all").toBe(272);

    for (let week = 1; week <= 3; week++) {
      await playToGameDay(page, week);
      const after = await continueTo(page, "regularSeason", week + 1);
      // Continue steps the week and nothing else: no game was played, none rewritten, the held slate is cleared
      expect(after.pending).toBeNull();
      expect(regGames(after)).toHaveLength(regGames(after, 1).length + regGames(after, 2).length + regGames(after, 3).length);
      expectSeasonConsistent(after, week);
      await expect(page).toHaveURL(HUB);
    }

    // after three weeks: the hub, the standings table and the schedule all say what the books say
    const s = await readSeason(page);
    expect(regGames(s)).toHaveLength(scheduledIn(s, 1).length + scheduledIn(s, 2).length + scheduledIn(s, 3).length);
    await expect(hubRecord(page)).toHaveText(recordText(s.teams[s.me]!));
    const mine = (AFC as readonly string[]).includes(s.me) ? AFC : NFC;
    const ranked = [...mine].sort((a, b) => s.teams[a]!.confRank - s.teams[b]!.confRank);
    const expected = ranked.map((code, i) => {
      const t = s.teams[code]!;
      return { seed: i < 7 ? String(i + 1) : "\u2013", name: teamIdentity(code).name, w: t.w, l: t.l, t: t.t, pf: t.pf, pa: t.pa, pd: t.pf - t.pa };
    });
    const shown = await standingsOnScreen(page);
    // Identity is checked per row even when records are equal. Soft failures keep schedule/accounting coverage running.
    expect.soft(shown, "each standings identity, seed, record and points must match persisted conference ranks").toEqual(expected);
    await page.getByRole("button", { name: "Full Schedule" }).click();
    for (let week = 1; week <= 3; week++) expect(await scheduleOnScreen(page, week), `week ${week}'s final scores on the schedule`).toEqual(scoresOf(s, week));
  });

  test("a reload never replays a game: on Game Day, after Continue, and into the next week", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page).toHaveURL(HUB);
    expect(regGames(await readSeason(page))).toHaveLength(0);

    // reload on the hub before anything is played: still nothing played
    await page.reload();
    await expect(page).toHaveURL(HUB);
    expect(regGames(await readSeason(page))).toHaveLength(0);

    const { results: week1 } = await playToGameDay(page, 1);
    const d1 = gamesDigest(week1);

    // reload on Game Day: the slate is held, shown again, and not played again
    await page.reload();
    await expect(page).toHaveURL(GAME_DAY);
    await expect(page.getByText("Week 1 · results are in")).toBeVisible();
    const reloaded = await readSeason(page);
    expect(gamesDigest(reloaded), "the same games with the same scores").toBe(d1);
    expect(reloaded.pending).toEqual(week1.pending);

    // Continue, then reload on the next week's hub: still those games and no more, nothing held
    await continueTo(page, "regularSeason", 2);
    await page.reload();
    await expect(page).toHaveURL(HUB);
    const hub2 = await readSeason(page);
    expect(gamesDigest(hub2)).toBe(d1);
    expect(hub2).toMatchObject({ stage: "regularSeason", week: 2, pending: null });
    expectSeasonConsistent(hub2, 1);

    // week two adds exactly week two's games and leaves week one's as they were
    const { results: week2 } = await playToGameDay(page, 2);
    expect(gamesDigest(week2).startsWith(d1)).toBe(true);
    expect(regGames(week2, 1).map((g) => `${g.id}:${g.homeScore}-${g.awayScore}`)).toEqual(regGames(week1, 1).map((g) => `${g.id}:${g.homeScore}-${g.awayScore}`));
    await page.reload();
    await expect(page).toHaveURL(GAME_DAY);
    expect(gamesDigest(await readSeason(page))).toBe(gamesDigest(week2));
  });
});

test.describe("the trade deadline", () => {
  test.use({ fixtureName: "season-week-9" });

  test("after week 9 the league goes through the deadline, its summary, the mid-season market and the depth chart, and plays on in week 10", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await expect(page).toHaveURL(HUB);
    const start = await readSeason(page);
    expect(regGames(start).length).toBe([1, 2, 3, 4, 5, 6, 7, 8].reduce((n, w) => n + scheduledIn(start, w).length, 0));
    expectSeasonConsistent(start, 8);

    // week 9 is the last before the deadline, and one team in a game short (byes): it is played like any other week
    const { results } = await playToGameDay(page, 9);
    expect(regGames(results, 9).length).toBeLessThan(16);
    const books = gamesDigest(results);
    const standings = JSON.stringify(results.teams);

    // the stages after it, in order: each is reached by the player's own action, and none plays a game or moves the week
    const seen: string[] = [`${results.stage}:${results.week}`];
    const reach = async (stage: string) => {
      await expect.poll(async () => (await readSeason(page)).stage, { message: `reached ${stage}` }).toBe(stage);
      const s = await readSeason(page);
      seen.push(`${s.stage}:${s.week}`);
      expect(gamesDigest(s), `${stage}: no game was played or changed`).toBe(books);
      expect(JSON.stringify(s.teams), `${stage}: the standings did not move`).toBe(standings);
    };

    await cont(page).click();
    await reach("tradeDeadline");
    await expect(page).toHaveURL(/#\/trade-deadline$/);
    // sit it out, and answer any offer that comes in the way a player does: turn it down
    await page.getByRole("checkbox", { name: /Skip the trade deadline/ }).click();
    for (let i = 0; i < 12; i++) {
      if ((await readSeason(page)).stage !== "tradeDeadline") break;
      const down = page.getByRole("button", { name: "Turn It Down" });
      if (await down.count()) await down.first().click();
      else await page.waitForTimeout(400);
    }
    await reach("tradeDeadlineSummary");
    await expect(page).toHaveURL(/#\/trade-summary$/);

    await page.getByRole("button", { name: "Advance to Mid-Season Free Agency" }).click();
    await reach("midseasonFreeAgency");
    await page.getByRole("checkbox", { name: /Skip free agency/ }).click();
    await reach("midseasonFreeAgencySummary");

    await page.getByRole("button", { name: "Advance to Re-order Depth Chart" }).click();
    await reach("midseasonDepthChart");

    await page.getByRole("button", { name: "Ready for Week 10" }).click();
    await expect.poll(async () => { const s = await readSeason(page); return `${s.stage}:${s.week}`; }).toBe("regularSeason:10");
    seen.push("regularSeason:10");
    expect(seen).toEqual(["regularSeason:9", "tradeDeadline:9", "tradeDeadlineSummary:9", "midseasonFreeAgency:9", "midseasonFreeAgencySummary:9", "midseasonDepthChart:9", "regularSeason:10"]);
    await expect(page).toHaveURL(HUB);
    await expect(page.getByText("Week 10", { exact: true }).first()).toBeVisible();

    // and the season goes on as before: week 10 is played once, on top of the same books
    const { results: week10 } = await playToGameDay(page, 10);
    expect(gamesDigest(week10).startsWith(books)).toBe(true);
    expectSeasonConsistent(week10, 10);
  });
});

test.describe("into the playoffs", () => {
  test.use({ fixtureName: "season-week-17" });

  test("after week 18 the regular season is complete, the right fourteen teams are seeded, and the bracket opens at the Wild Card unplayed", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await expect(page).toHaveURL(HUB);
    const start = await readSeason(page);
    expectSeasonConsistent(start, 16);
    expect(start.bracket, "no bracket before the regular season ends").toBeNull();

    await playToGameDay(page, 17);
    await continueTo(page, "regularSeason", 18);
    await expect(page).toHaveURL(HUB);
    const { results } = await playToGameDay(page, 18);
    expect(results.bracket, "the bracket is not made until the season is over").toBeNull();

    // the last week is played; the league moves on to the playoffs
    const end = await continueTo(page, "playoffs", 0);
    await expect(page).toHaveURL(/#\/bracket$/);

    // the regular season is complete: every game on the schedule, once, every team at 17
    expect(regGames(end)).toHaveLength(272);
    expectSeasonConsistent(end, 18);
    for (const [code, t] of Object.entries(end.teams)) expect(t.w + t.l + t.t, `${code} played seventeen games`).toBe(17);
    expect(end.games.filter((g) => g.phase !== "REG" && g.phase !== "PRE"), "no playoff game has been played").toEqual([]);

    // the bracket: seven a conference, the right conference, no one twice, a bye for the one seed, the rest paired 2-7, 3-6, 4-5
    const b = end.bracket!;
    expect(b).toMatchObject({ round: "WC", champion: null });
    const authoritative = authoritativeSeeding(end);
    for (const [conf, members] of [["AFC", AFC], ["NFC", NFC]] as const) {
      const seeds = b.seeds[conf];
      expect(seeds, `${conf}: seven seeds`).toHaveLength(7);
      expect(new Set(seeds).size).toBe(7);
      for (const c of seeds) expect(members as readonly string[], `${c} is in the ${conf}`).toContain(c);

      // These are ordinary failing assertions, never annotations or expected-failure/skip markers.
      // Soft assertions expose both conferences and still exercise the UI, pairings and reload after a seeding defect.
      const expected = authoritative[conf];
      expect.soft(seeds, `${conf}: exact main-engine seed order from completed games`).toEqual(expected.seeds);
      expect.soft(seeds.slice(0, 4), `${conf}: seeds 1-4 are the four division champions`).toEqual(expected.divisionWinners);
      expect.soft(seeds.slice(4), `${conf}: seeds 5-7 are the three authoritative wild cards`).toEqual(expected.wildCards);

      const wc = b.matchups.filter((m) => m.round === "WC" && m.conference === conf);
      expect(wc).toHaveLength(4);
      const bye = wc.find((m) => m.low === null)!;
      expect.soft(bye.high, `${conf}: authoritative bye team`).toEqual({ code: expected.seeds[0], seed: 1 });
      expect.soft(bye.winner).toBe(expected.seeds[0]);
      for (const [hi, lo] of [[2, 7], [3, 6], [4, 5]] as const) {
        const m = wc.find((x) => x.high?.seed === hi)!;
        expect.soft(m.high, `${conf}: seed ${hi} hosts seed ${lo}`).toEqual({ code: expected.seeds[hi - 1], seed: hi });
        expect.soft(m.low).toEqual({ code: expected.seeds[lo - 1], seed: lo });
        expect(m.winner, "not played yet").toBeNull();
        expect(m.homeScore).toBeNull();
      }
    }
    expect(b.matchups.every((m) => m.round === "WC")).toBe(true);

    // the screen shows the same fourteen teams with the same records, and the round waiting to be played
    // (the screen shows one conference at a time)
    const all = [...b.seeds.AFC, ...b.seeds.NFC];
    for (const conf of ["AFC", "NFC"] as const) {
      await page.getByRole("tab", { name: conf, exact: true }).or(page.getByRole("button", { name: conf, exact: true })).first().click();
      const expectedRows = b.matchups.filter((m) => m.round === "WC" && m.conference === conf)
        .flatMap((m) => [m.high, m.low]).filter((side) => side !== null)
        .map((side) => ({ label: teamIdentity(side.code).label, seed: side.seed, record: recordText(end.teams[side.code]!) }));
      expect.soft(await bracketOnScreen(page), `${conf}: every rendered team identity, seed and record matches the saved matchup`).toEqual(expectedRows);
    }
    await expect(page.getByRole("button", { name: "Simulate the Wild Card" })).toBeVisible();
    // and what it says about the viewer's own team agrees: out of the field reads "Missed"
    if (!all.includes(end.me)) await expect(statBeside(page, "Your team")).toHaveText("Missed");

    // a reload finds the same bracket, still unplayed
    await page.reload();
    await expect(page).toHaveURL(/#\/bracket$/);
    const again = await readSeason(page);
    expect(again.bracket).toEqual(b);
    expect(again.stage).toBe("playoffs");
    expect(regGames(again)).toHaveLength(272);
  });
});


// Reader negative controls use the real rendered page. Substituted identities must not disappear in numeric sorting.
test.describe("team identity negative controls", () => {
  test.use({ fixtureName: "season-week-1" });
  test("the standings comparison rejects another team's name even when every number stays unchanged", async ({ page }) => {
    await page.goto("/");
    const s = await readSeason(page);
    const members = (AFC as readonly string[]).includes(s.me) ? AFC : NFC;
    const shown = await standingsOnScreen(page);
    const byName = (rows: typeof shown) => rows.slice().sort((a, b) => a.name!.localeCompare(b.name!));
    const expected = shown.map((row) => {
      const code = members.find((c) => teamIdentity(c).name === row.name);
      expect(code, "every rendered identity belongs to the persisted conference").toBeTruthy();
      const t = s.teams[code!]!;
      return { ...row, name: teamIdentity(code!).name, w: t.w, l: t.l, t: t.t, pf: t.pf, pa: t.pa, pd: t.pf - t.pa };
    });
    expect(byName(shown)).toEqual(byName(expected));
    const cells = page.locator("main table:visible tbody tr td:nth-child(2)");
    const replacement = await cells.nth(1).innerText();
    await cells.first().evaluate((cell, text) => { cell.textContent = text; }, replacement);
    const corrupted = await standingsOnScreen(page);
    expect(corrupted.map(({ name, ...numbers }) => numbers)).toEqual(shown.map(({ name, ...numbers }) => numbers));
    expect(() => expect(byName(corrupted)).toEqual(byName(expected))).toThrow();
  });
});

test.describe("bracket identity negative control", () => {
  test.use({ fixtureName: "season-week-17" });
  test("the bracket comparison rejects another team's name without changing its seed or record", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await playToGameDay(page, 17);
    await continueTo(page, "regularSeason", 18);
    await playToGameDay(page, 18);
    const s = await continueTo(page, "playoffs", 0);
    await expect(page).toHaveURL(/#\/bracket$/);
    await page.getByRole("tab", { name: "AFC", exact: true }).or(page.getByRole("button", { name: "AFC", exact: true })).first().click();
    const expected = s.bracket!.matchups.filter((m) => m.round === "WC" && m.conference === "AFC")
      .flatMap((m) => [m.high, m.low]).filter((side) => side !== null)
      .map((side) => ({ label: teamIdentity(side.code).label, seed: side.seed, record: recordText(s.teams[side.code]!) }));
    const shown = await bracketOnScreen(page);
    expect(shown).toEqual(expected);
    await page.locator(".panel.open .bracket-col").first().evaluate((col) => {
      const record = Array.from(col.querySelectorAll("span")).find((el) => el.children.length === 0 && /^\d+ OVR · /.test(el.textContent?.trim() ?? ""))!;
      record.parentElement!.querySelector("span")!.textContent = "Baltimore";
    });
    const corrupted = await bracketOnScreen(page);
    expect(corrupted.map(({ label, ...numbers }) => numbers)).toEqual(shown.map(({ label, ...numbers }) => numbers));
    expect(() => expect(corrupted).toEqual(expected)).toThrow();
  });
});
