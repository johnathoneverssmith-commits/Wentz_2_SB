import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { installLifecycleProbe } from "./lifecycle-probe";
const externalRequests = new WeakMap<Page, string[]>();
const position = async (page: Page, id: string) => {
    const coordinate = async (axis: string) => {
        const cell = page.getByTestId(`${id}-${axis}`);
        await expect(cell).toBeVisible();
        const text = await cell.innerText();
        expect(text).toMatch(/^\d+\.\d{2}$/);
        return Number(text);
    };
    return { x: await coordinate("x"), y: await coordinate("y") };
};
test.beforeEach(async ({ page }) => {
    await installLifecycleProbe(page);
    // This standalone entry is not allowed to contact any API or persist franchise state.
    const external: string[] = [];
    externalRequests.set(page, external);
    await page.route("**/*", route => {
        if (new URL(route.request().url()).origin !== "http://127.0.0.1:5184") {
            external.push(route.request().url());
            return route.abort();
        }
        return route.continue();
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Backyard football" })).toBeVisible();
    await page.getByText("Player positions", { exact: false }).click();
    await page.getByRole("img", { name: /Football field/ }).click();
    expect(external).toEqual([]);
    await page.getByLabel("Play", { exact: true }).selectOption("go");
    await page.getByRole("button", { name: "Snap", exact: true }).click();
});
test("restart clears both physically held movement keys without needing keyup", async ({ page }) => {
    await page.keyboard.down("KeyD");
    await page.keyboard.down("ArrowLeft");
    await expect.poll(async () => (await position(page, "home-1")).x).toBeGreaterThan(39);
    await expect.poll(async () => (await position(page, "away-1")).x).toBeLessThan(71);
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    await page.getByLabel("Play", { exact: true }).selectOption("go");
    await page.getByRole("button", { name: "Snap", exact: true }).click();
    await page.waitForTimeout(300); // both physical keys are deliberately still held
    expect(await position(page, "home-1"), "restart must discard the held blue input").toEqual({ x: 38, y: 26.67 });
    expect(await position(page, "away-1"), "restart must discard the held orange input").toEqual({ x: 72, y: 26.67 });
    await page.keyboard.up("KeyD");
    await page.keyboard.up("ArrowLeft");
});
test("restart from paused resumes live practice and AI movement", async ({ page }) => {
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    expect(await page.getByRole("button", { name: /^(Pause|Resume)$/ }).innerText(), "restart resumes rather than retaining paused state").toBe("Pause");
    await page.getByLabel("Play", { exact: true }).selectOption("go");
    await page.getByRole("button", { name: "Snap", exact: true }).click();
    await expect(page.getByText("Live play", { exact: true })).toBeVisible();
    await expect.poll(async () => (await position(page, "home-2")).x).toBeGreaterThan(37);
});
test("React effect replay leaves exactly one keyboard listener set and one animation loop", async ({ page }) => {
    const read = () => page.evaluate(async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        return window.arcadeLifecycle.read();
    });
    const lifecycle = await read();
    expect(lifecycle.setups, "Strict Mode must actually re-execute the effect").toBeGreaterThanOrEqual(2);
    expect(lifecycle, "effect replay must not leak active listeners or frame callbacks").toMatchObject({ keydown: 1, keyup: 1, blur: 1, visibilitychange: 1, pendingFrames: 1 });
    expect(lifecycle.cleanups, "the first effect must remove its keyboard listener").toBeGreaterThanOrEqual(1);
    expect(lifecycle.cancelledFrames, "the first effect must cancel its scheduled frame").toBeGreaterThanOrEqual(1);
    await page.keyboard.down("KeyD");
    await expect.poll(async () => (await position(page, "home-1")).x).toBeGreaterThan(39);
    await page.keyboard.up("KeyD");
    for (let i = 0; i < 3; i++)
        await page.getByRole("button", { name: "Restart", exact: true }).click();
    expect(await read()).toMatchObject({ keydown: 1, keyup: 1, blur: 1, visibilitychange: 1, pendingFrames: 1 });
});
test.afterEach(async ({ page }) => {
    expect(externalRequests.get(page)).toEqual([]);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(["wentz.arcade.down.v1"]);
});
test("both humans move simultaneously through real keyboard input", async ({ page }) => {
    const home = await position(page, "home-1"), away = await position(page, "away-1");
    await page.keyboard.down("KeyD");
    await page.keyboard.down("ArrowLeft");
    await expect.poll(async () => (await position(page, "home-1")).x).toBeGreaterThan(home.x + 1);
    await expect.poll(async () => (await position(page, "away-1")).x).toBeLessThan(away.x - 1);
    await page.keyboard.up("KeyD");
    await page.keyboard.up("ArrowLeft");
    await page.screenshot({ path: test.info().outputPath("sandbox.png"), fullPage: true });
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const stopped = await position(page, "home-1");
    await page.waitForTimeout(180);
    expect(await position(page, "home-1")).toEqual(stopped);
    await expect(page.getByText("Bluebirds possession · #1", { exact: false })).toBeVisible();
    await expect(page.getByRole("img", { name: /Football field/ })).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(["wentz.arcade.down.v1"]);
});
test("pause freezes the drill and restart restores both players without held keys", async ({ page }) => {
    await page.keyboard.down("KeyD");
    await expect.poll(async () => (await position(page, "home-1")).x).toBeGreaterThan(39);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = await position(page, "home-1");
    const pausedRoster = await page.getByRole("table").innerText();
    await page.waitForTimeout(200);
    expect(await position(page, "home-1")).toEqual(paused);
    expect(await page.getByRole("table").innerText()).toEqual(pausedRoster);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await position(page, "home-1")).toEqual(paused);
    await page.keyboard.up("KeyD");
    await page.getByRole("button", { name: "Restart", exact: true }).click();
    await page.getByLabel("Play", { exact: true }).selectOption("go");
    await page.getByRole("button", { name: "Snap", exact: true }).click();
    await expect.poll(async () => (await position(page, "home-1")).x).toBe(38);
    expect((await position(page, "away-1")).x).toBe(72);
    await page.keyboard.down("ArrowUp");
    await expect.poll(async () => (await position(page, "away-1")).y).toBeLessThan(25);
    await page.keyboard.up("ArrowUp");
});
test("keyboard navigation on the roster disclosure does not control a player", async ({ page }) => {
    const before = await position(page, "away-1");
    await page.locator("summary").focus();
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(200);
    await page.keyboard.up("ArrowRight");
    expect(await position(page, "away-1")).toEqual(before);
});
test("a hidden-page lifecycle event pauses all players and clears input", async ({ page }) => {
    await page.keyboard.down("KeyD");
    await expect.poll(async () => (await position(page, "home-1")).x).toBeGreaterThan(39);
    await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    const roster = await page.getByRole("table").innerText();
    await page.waitForTimeout(200);
    expect(await page.getByRole("table").innerText()).toBe(roster);
    await page.evaluate(() => { delete (document as unknown as {
        hidden?: boolean;
    }).hidden; });
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    const stopped = await position(page, "home-1");
    await page.waitForTimeout(200);
    expect(await position(page, "home-1")).toEqual(stopped);
    await page.keyboard.up("KeyD");
});
test("blur clears held movement and pauses until an explicit resume", async ({ page }) => {
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await position(page, "home-1")).y).toBeLessThan(25);
    // Dispatch the browser lifecycle event while the real key is still down.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    const stopped = await position(page, "home-1");
    await page.waitForTimeout(200);
    expect(await position(page, "home-1")).toEqual(stopped);
    await page.getByRole("button", { name: "Resume", exact: true }).click();
    await page.waitForTimeout(200);
    expect(await position(page, "home-1")).toEqual(stopped);
    await page.keyboard.up("KeyW");
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await position(page, "home-1")).y).toBeLessThan(stopped.y - 1);
    await page.keyboard.up("KeyW");
});
