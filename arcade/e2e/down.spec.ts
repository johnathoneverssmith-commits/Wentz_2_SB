import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
import { withoutClock } from './helpers';
const saved = (page: Page): Promise<DownState> => page.evaluate(() => JSON.parse(localStorage.getItem('wentz.arcade.down.v1')!).state);
const field = (page: Page) => page.getByRole('img', { name: /Football field/ });
test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5184' ? route.continue() : route.abort());
    await page.goto('/?seed=1');
});
test('a real handoff lets both humans move, tackle and begin the next down', async ({ page }) => {
    await expect(page.getByTestId('phase')).toHaveText('Pre-snap');
    await page.getByRole('button', { name: 'Snap', exact: true }).click();
    await expect.poll(async () => (await saved(page)).possession.carrier).toBe('home-RB');
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowLeft');
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === 'home-RB')!.x).toBeGreaterThan(31);
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === 'away-MLB')!.x).toBeLessThan(44.6);
    await expect(page.getByTestId('phase')).toHaveText('Play complete');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowLeft');
    const dead = await saved(page);
    expect(dead.result?.reason).toBe('tackle');
    expect(dead.result?.turnover).toBe(false);
    await expect(page.getByTestId('result')).toHaveText(`Bluebirds: ${dead.result!.yards.toFixed(1)} offensive yards · Turnover: No · Touchdown: No`);
    await page.waitForTimeout(150);
    expect(withoutClock(await saved(page))).toEqual(withoutClock(dead));
    await page.getByRole('button', { name: 'Next down', exact: true }).click();
    await expect(page.getByText('Play 2 · Bluebirds ball', { exact: false })).toBeVisible();
    const next = await saved(page);
    expect(next.phase).toBe('pre-snap');
    expect(next.result).toBeNull();
    expect(next.line).toBeCloseTo(dead.players.find(p => p.id === dead.possession.carrier)!.x, 10);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('phase')).toHaveText('Live play');
});
// A slants throw to the second receiver once he has broken free, and a go throw to the first at once: both are open windows against the AI.
for (const [play, key, target, wait] of [['slants', 'KeyE', 'home-WR2', 640], ['go', 'KeyQ', 'home-WR1', 0]] as const) {
    test(`real ${play} pass transfers control to ${target} and reload freezes its saved state`, async ({ page }) => {
        // Keep exact catch/reload assertions independent of wall-clock UI latency.
        // Separate wall-clock playthrough tests below prove ordinary real-time agency.
        await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') });
        // install starts a running clock; pause ahead of it to avoid racing wall time on CI.
        await page.clock.pauseAt(new Date('2026-10-19T12:01:00Z'));
        await page.reload();
        await page.clock.runFor(128);
        await page.getByLabel('Play', { exact: true }).selectOption(play);
        await page.keyboard.press('Enter');
        if (wait) await page.clock.runFor(wait);
        await page.keyboard.press(key);
        await page.clock.runFor(160);
        expect((await saved(page)).ball.kind).toBe('flight');
        // Hold movement during flight: control must transfer seamlessly on the catch.
        await page.keyboard.down('KeyA');
        await page.clock.runFor(1000);
        const landed = await saved(page);
        // Against the real AI the pass is caught, broken up or intercepted; the catch hands control to the receiver.
        if (landed.possession.carrier === target) {
            await expect(page.getByText('Bluebirds possession', { exact: false })).toBeVisible();
            const x = landed.players.find(p => p.id === target)!.x;
            await page.clock.runFor(160);
            const after = await saved(page);
            // a catch with a defender at the ball (a contested catch) is tackled where he stands: then the down is over and he has not moved; otherwise he runs left
            if (after.phase === 'live') expect(after.players.find(p => p.id === target)!.x).toBeLessThan(x - .3);
            else expect(after.result?.reason).toBe('tackle');
        }
        else expect(['incomplete', 'interception', 'tackle']).toContain(landed.result?.reason);
        await page.keyboard.up('KeyA');
        if (landed.phase === 'live') await page.getByRole('button', { name: 'Pause', exact: true }).click();
        const before = await saved(page);
        await page.reload();
        await page.clock.runFor(128);
        await expect(page.getByTestId('phase')).toHaveText('Paused');
        expect(await saved(page)).toEqual(before);
        await page.clock.runFor(150);
        expect(await saved(page)).toEqual(before);
        await page.getByText('Player positions', { exact: false }).click();
        for (const p of before.players) {
            await expect(page.getByTestId(`${p.id}-x`)).toHaveText(p.x.toFixed(2));
            await expect(page.getByTestId(`${p.id}-y`)).toHaveText(p.y.toFixed(2));
        }
    });
}
test('switching changes the actual human-controlled defender', async ({ page }) => {
    await page.getByRole('button', { name: 'Snap', exact: true }).click();
    const first = (await saved(page)).defender;
    await page.keyboard.press('Slash');
    await expect.poll(async () => (await saved(page)).defender).not.toBe(first);
    const now = (await saved(page)).defender;
    const before = (await saved(page)).players.find(p => p.id === now)!;
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === now)!.x).toBeGreaterThan(before.x + .4);
    await page.keyboard.up('ArrowRight');
    await expect(page.getByText('Defense: Foxes', { exact: false })).toBeVisible();
    expect((await saved(page)).players.filter(p => p.team === 'away' && p.human)).toHaveLength(1);
});
test('arcade saving preserves unrelated storage and restart clears the saved down', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('unrelated-sentinel', 'unchanged'));
    await page.getByRole('button', { name: 'Snap', exact: true }).click();
    await page.keyboard.down('KeyD');
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === 'home-RB')!.x).toBeGreaterThan(31);
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await page.keyboard.up('KeyD');
    const state = await saved(page);
    expect(state.phase).toBe('pre-snap');
    expect(state.playNumber).toBe(1);
    expect(state.possession.carrier).toBe('home-RB');
    expect(await page.evaluate(() => localStorage.getItem('unrelated-sentinel'))).toBe('unchanged');
    await field(page).click();
    await page.screenshot({ path: test.info().outputPath('playable-down.png'), fullPage: true });
});
test('wall-clock keyboard playthroughs resolve ordinary passes: the ball lands, the play ends or the catcher runs, and Hands changes nothing it should not', async ({ page }) => {
    for (const hands of [false, true]) {
        await page.getByRole('button', { name: 'Restart', exact: true }).click();
        await page.getByLabel('Play', { exact: true }).selectOption('slants');
        await page.getByRole('button', { name: 'Snap', exact: true }).click();
        await page.waitForTimeout(700);
        await page.keyboard.press('KeyE');
        await expect.poll(async () => (await saved(page)).ball.kind, { intervals: [25] }).toBe('flight');
        if (hands) await page.keyboard.press('ShiftRight');
        await expect.poll(async () => (await saved(page)).ball.kind, { intervals: [25], timeout: 5000 }).toBe('held');
        const final = await saved(page);
        // a catch leaves the play live with the receiver as carrier; otherwise the pass ended the down as incomplete or intercepted
        if (final.phase === 'live') expect(final.possession.carrier).toBe('home-WR2');
        else expect(['incomplete', 'interception']).toContain(final.result?.reason);
    }
});
test('wall-clock rushing playthroughs respond to both human decisions', async ({ page }) => {
    async function run(evade = false, retreat = false) {
        await page.getByRole('button', { name: 'Restart', exact: true }).click();
        await page.getByRole('button', { name: 'Snap', exact: true }).click();
        await page.keyboard.down('KeyD');
        if (evade)
            await page.keyboard.down('KeyW');
        await page.keyboard.down(retreat ? 'ArrowRight' : 'ArrowLeft');
        await expect.poll(async () => (await saved(page)).phase, { intervals: [25], timeout: 20_000 }).toBe('dead');
        for (const key of ['KeyD', 'KeyW', 'ArrowLeft', 'ArrowRight'])
            await page.keyboard.up(key);
        return (await saved(page)).result!.yards;
    }
    const results = [await run(), await run(false, true), await run(true, false)];
    for (const y of results) expect(Number.isFinite(y)).toBe(true);
    expect(new Set(results.map(y => y.toFixed(1))).size, 'the human decisions change the result').toBeGreaterThan(1);
});
