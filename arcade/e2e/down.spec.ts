import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
const saved = (page: Page): Promise<DownState> => page.evaluate(() => JSON.parse(localStorage.getItem('wentz.arcade.down.v1')!).state);
const field = (page: Page) => page.getByRole('img', { name: /Football field/ });
test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5184' ? route.continue() : route.abort());
    await page.goto('/');
});
test('a real handoff lets both humans move, tackle and begin the next down', async ({ page }) => {
    await expect(page.getByTestId('phase')).toHaveText('Pre-snap');
    await page.getByRole('button', { name: 'Snap', exact: true }).click();
    await expect.poll(async () => (await saved(page)).possession.carrier).toBe('home-2');
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowLeft');
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === 'home-2')!.x).toBeGreaterThan(39);
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === 'away-1')!.x).toBeLessThan(71);
    await expect(page.getByTestId('phase')).toHaveText('Play complete');
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowLeft');
    const dead = await saved(page);
    expect(dead.result?.reason).toBe('tackle');
    expect(dead.result?.turnover).toBe(false);
    await expect(page.getByTestId('result')).toHaveText(`${dead.result!.yards.toFixed(1)} yards · Turnover: No · Touchdown: No`);
    await page.waitForTimeout(150);
    expect(await saved(page)).toEqual(dead);
    await page.getByRole('button', { name: 'Next down', exact: true }).click();
    await expect(page.getByText('Down 2', { exact: true })).toBeVisible();
    const next = await saved(page);
    expect(next.phase).toBe('pre-snap');
    expect(next.result).toBeNull();
    expect(next.line).toBeCloseTo(dead.players.find(p => p.id === dead.possession.carrier)!.x, 10);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('phase')).toHaveText('Live play');
});
for (const [play, key, target] of [['slants', 'KeyQ', 'home-3'], ['go', 'KeyE', 'home-4']] as const) {
    test(`real ${play} pass transfers control to ${target} and reload freezes its saved state`, async ({ page }) => {
        await page.getByLabel('Play', { exact: true }).selectOption(play);
        await page.keyboard.press('Enter');
        await page.keyboard.press(key);
        await expect.poll(async () => (await saved(page)).ball.kind).toBe('flight');
        await expect.poll(async () => (await saved(page)).possession.carrier).toBe(target);
        await expect(page.getByText(`Bluebirds possession · #${target.slice(-1)}`, { exact: false })).toBeVisible();
        await page.keyboard.down('KeyA');
        const x = (await saved(page)).players.find(p => p.id === target)!.x;
        await expect.poll(async () => (await saved(page)).players.find(p => p.id === target)!.x).toBeLessThan(x - .3);
        await page.keyboard.up('KeyA');
        await page.getByRole('button', { name: 'Pause', exact: true }).click();
        const before = await saved(page);
        await page.reload();
        await expect(page.getByTestId('phase')).toHaveText('Paused');
        expect(await saved(page)).toEqual(before);
        await page.waitForTimeout(150);
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
    await page.keyboard.press('Slash');
    await expect.poll(async () => (await saved(page)).defender).toBe('away-2');
    const before = (await saved(page)).players.find(p => p.id === 'away-2')!;
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === 'away-2')!.x).toBeGreaterThan(before.x + .4);
    await page.keyboard.up('ArrowRight');
    await expect(page.getByText('Defense: #2', { exact: false })).toBeVisible();
});
test('arcade saving preserves unrelated storage and restart clears the saved down', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('unrelated-sentinel', 'unchanged'));
    await page.getByRole('button', { name: 'Snap', exact: true }).click();
    await page.keyboard.down('KeyD');
    await expect.poll(async () => (await saved(page)).players.find(p => p.id === 'home-2')!.x).toBeGreaterThan(39);
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await page.keyboard.up('KeyD');
    const state = await saved(page);
    expect(state.phase).toBe('pre-snap');
    expect(state.playNumber).toBe(1);
    expect(state.possession.carrier).toBe('home-1');
    expect(await page.evaluate(() => localStorage.getItem('unrelated-sentinel'))).toBe('unchanged');
    await field(page).click();
    await page.screenshot({ path: test.info().outputPath('playable-down.png'), fullPage: true });
});
