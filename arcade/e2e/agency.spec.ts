import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
import { withoutClock } from './helpers';
const saved = (page: Page): Promise<DownState> => page.evaluate(() => JSON.parse(localStorage.getItem('wentz.arcade.down.v1')!).state);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const requests = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
    const external: string[] = [];
    requests.set(page, external);
    await page.route('**/*', r => { if (new URL(r.request().url()).origin !== 'http://127.0.0.1:5184') {
        external.push(r.request().url());
        return r.abort();
    } return r.continue(); });
    // Browser clock controls only time: keyboard events, React, RAF and saving are real.
    await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-19T12:00:00Z'));
    await page.goto('/');
    await page.clock.runFor(128);
});
test.afterEach(async ({ page }) => { expect(requests.get(page)).toEqual([]); });
async function beginPass(page: Page, play = 'slants') {
    await page.getByLabel('Play', { exact: true }).selectOption(play);
    await button(page, 'Snap').click();
}
async function humanPass(page: Page, mode: 'complete' | 'breakup' | 'intercept') {
    await beginPass(page);
    if (mode !== 'complete')
        await page.keyboard.down('ArrowUp');
    await page.keyboard.press('KeyQ');
    await page.clock.runFor(528);
    if (mode !== 'complete')
        await page.keyboard.up('ArrowUp');
    await page.clock.runFor(144);
    if (mode === 'intercept')
        await page.keyboard.press('ShiftRight');
    await page.clock.runFor(432);
    return saved(page);
}
test('identical starting passes have three outcomes controlled by the human defender', async ({ page }) => {
    const complete = await humanPass(page, 'complete');
    expect(complete.phase).toBe('live');
    expect(complete.possession.carrier).toBe('home-3');
    await button(page, 'Restart').click();
    const broken = await humanPass(page, 'breakup');
    expect(broken.result?.reason).toBe('incomplete');
    expect(broken.terminalCount).toBe(1);
    await button(page, 'Restart').click();
    const intercepted = await humanPass(page, 'intercept');
    expect(intercepted.result).toMatchObject({ reason: 'interception', yards: 0, turnover: true });
    expect(intercepted.possession.team).toBe('away');
    expect(await page.getByTestId('result').innerText()).toContain('0.0 offensive yards');
    await expect(page.getByText('Foxes possession', { exact: false })).toBeVisible();
});
test('real defensive pursuit and offensive evasion change rushing yards from the same formation', async ({ page }) => {
    async function run(evade = false, pursue = true) {
        await button(page, 'Snap').click();
        await page.keyboard.down('KeyD');
        if (evade)
            await page.keyboard.down('KeyW');
        await page.keyboard.down(pursue ? 'ArrowLeft' : 'ArrowRight');
        await page.clock.runFor(4000);
        await page.keyboard.up('KeyD');
        await page.keyboard.up('KeyW');
        await page.keyboard.up('ArrowLeft');
        await page.keyboard.up('ArrowRight');
        return saved(page);
    }
    const early = await run();
    expect(early.liveTicks).toBe(24);
    expect(early.result?.yards).toBe(2.5);
    // Independent geometry: (7 - 1.8)/(7 + 6.25)*60 => contact tick 24; 6.25*24/60 = 2.5.
    expect(await page.getByTestId('result').innerText()).toContain('2.5 offensive yards');
    await button(page, 'Restart').click();
    const late = await run(false, false);
    expect(late.result!.yards).toBeGreaterThan(2.5);
    await button(page, 'Restart').click();
    const evade = await run(true, true);
    expect(evade.result!.yards).toBeGreaterThan(2.5);
});
test('reloading an unpaused airborne pass preserves flight and its eventual exact result', async ({ page }) => {
    await beginPass(page, 'go');
    await page.keyboard.press('KeyQ');
    await page.clock.runFor(3000);
    const uninterrupted = await saved(page);
    expect(uninterrupted.phase).toBe('dead');
    expect(uninterrupted.terminalCount).toBe(1);
    await button(page, 'Restart').click();
    await beginPass(page, 'go');
    await page.keyboard.press('KeyQ');
    await page.clock.runFor(240);
    const air = await saved(page);
    expect(air.ball.kind).toBe('flight');
    if (air.ball.kind !== 'flight')
        throw Error('airborne precondition');
    expect(air.ball.elapsed).toBeGreaterThan(0);
    expect(air.ball.elapsed).toBeLessThan(air.ball.duration);
    expect(air.phase).toBe('live');
    await expect(button(page, 'Pause')).toBeVisible();
    await expect(page.getByTestId('phase')).toHaveText('Live play');
    await page.reload();
    await page.clock.runFor(256);
    expect(await saved(page), 'airborne state must survive reload exactly').toEqual(air);
    expect(await page.getByTestId('phase').innerText(), 'reload must pause a genuinely live flight').toBe('Paused');
    await button(page, 'Resume').click();
    await page.clock.runFor(3000);
    expect(withoutClock(await saved(page)), 'reload cannot duplicate or change the eventual result').toEqual(withoutClock(uninterrupted));
});
test('completed-down reload cannot alter or replay its result before Next down', async ({ page }) => {
    await button(page, 'Snap').click();
    await page.keyboard.down('KeyD');
    await page.keyboard.down('ArrowLeft');
    await page.clock.runFor(640);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowLeft');
    const dead = await saved(page);
    expect(dead.result?.yards).toBe(2.5);
    expect(dead.terminalCount).toBe(1);
    await page.reload();
    await page.clock.runFor(2000);
    expect(await saved(page), 'completed snapshot remains unchanged after reload and time').toEqual(dead);
    expect(await page.getByTestId('terminal-count').innerText()).toBe('Completed plays: 1');
    await button(page, 'Resume').click();
    await button(page, 'Next down').click();
    const next = await saved(page);
    expect(next.playNumber).toBe(dead.playNumber + 1);
    expect(next.result).toBeNull();
    expect(next.terminalCount).toBe(1);
});
test('turnover gives Orange its own passing keys and Blue its own defense controls', async ({ page }) => {
    expect((await humanPass(page, 'intercept')).result?.reason).toBe('interception');
    await button(page, 'Next down').click();
    await beginPass(page);
    await page.keyboard.press('KeyQ');
    expect((await saved(page)).ball.kind, 'Blue cannot pass for Orange').toBe('held');
    await page.keyboard.press('Comma');
    expect((await saved(page)).ball.kind).toBe('flight');
    await page.keyboard.press('KeyR');
    expect((await saved(page)).contestUntil).toBeGreaterThan(0);
    await page.clock.runFor(1104);
    expect((await saved(page)).possession.carrier).toBe('away-3');
    await page.keyboard.press('KeyF');
    expect((await saved(page)).defender).toBe('home-2');
    const before = await saved(page);
    await page.keyboard.down('KeyA');
    await page.keyboard.down('ArrowLeft');
    await page.clock.runFor(160);
    const after = await saved(page);
    expect(after.players.find(p => p.id === 'home-2')!.human).toBe(true);
    expect(after.players.find(p => p.id === 'away-3')!.human).toBe(true);
    expect(after.players.find(p => p.id === 'home-2')!.x).toBeLessThan(before.players.find(p => p.id === 'home-2')!.x);
    expect(after.players.find(p => p.id === 'away-3')!.x).toBeLessThan(before.players.find(p => p.id === 'away-3')!.x);
    await page.keyboard.up('KeyA');
    await page.keyboard.up('ArrowLeft');
});
