import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
import { withoutClock } from './helpers';
import { lineUp } from '../core/down';
import { encodeSave } from '../browser/save';
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
    await page.clock.pauseAt(new Date('2026-10-19T12:01:00Z'));
    await page.goto('/');
    await page.clock.runFor(128);
});
test.afterEach(async ({ page }) => { expect(requests.get(page)).toEqual([]); });
async function beginPass(page: Page, play = 'slants') {
    await page.getByLabel('Play', { exact: true }).selectOption(play);
    await button(page, 'Snap').click();
}
test('the Hands key opens its timed window during a real pass, and the pass still resolves exactly once', async ({ page }) => {
    await beginPass(page);
    await page.clock.runFor(700);
    await page.keyboard.press('KeyE');
    expect((await saved(page)).ball.kind).toBe('flight');
    await page.keyboard.press('ShiftRight');
    expect((await saved(page)).contestUntil, 'the window opens').toBeGreaterThan(0);
    await page.clock.runFor(1500);
    const after = await saved(page);
    expect(after.ball.kind).toBe('held');
    if (after.phase === 'dead') expect(after.terminalCount).toBe(1);
    else expect(after.possession.carrier).toBe('home-WR2');
});
test('real defensive pursuit and offensive evasion change the same run', async ({ page }) => {
    async function run(evade: boolean, pursue: boolean) {
        await button(page, 'Snap').click();
        await page.keyboard.down('KeyD');
        if (evade) await page.keyboard.down('KeyW');
        if (pursue) await page.keyboard.down('ArrowLeft');
        await page.clock.runFor(6000);
        await page.keyboard.up('KeyD'); await page.keyboard.up('KeyW'); await page.keyboard.up('ArrowLeft');
        const s = await saved(page);
        expect(s.phase).toBe('dead');
        return `${s.result!.reason}:${s.result!.yards}:${s.liveTicks}`;
    }
    const base = await run(false, true);
    await button(page, 'Restart').click();
    const idleDefense = await run(false, false);
    await button(page, 'Restart').click();
    const evading = await run(true, true);
    expect(new Set([base, idleDefense, evading]).size, 'the two human decisions change the run').toBeGreaterThan(1);
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
    for (let i = 0; i < 20 && (await saved(page)).phase === 'live'; i++) await page.clock.runFor(500);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowLeft');
    const dead = await saved(page);
    expect(dead.phase).toBe('dead');
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
test('when Orange has the ball it uses its own passing keys, and Blue defends with its own', async ({ page }) => {
    await page.addInitScript(([key, value]) => localStorage.setItem(key as string, value as string), ['wentz.arcade.down.v1', encodeSave(lineUp('away', 82))]);
    await page.reload();
    await page.clock.runFor(128);
    await beginPass(page);
    await page.clock.runFor(700);
    await page.keyboard.press('KeyQ');
    expect((await saved(page)).ball.kind, 'Blue cannot pass for Orange').toBe('held');
    await page.keyboard.press('Comma');
    expect((await saved(page)).ball.kind).toBe('flight');
    await page.keyboard.press('KeyR');
    expect((await saved(page)).contestUntil, 'Blue Hands key belongs to the defender').toBeGreaterThan(0);
    await page.clock.runFor(1500);
    const first = (await saved(page)).defender;
    await page.keyboard.press('KeyF');
    const after = await saved(page);
    if (after.phase === 'live') {
        expect(after.defender).not.toBe(first);
        expect(after.defender.startsWith('home-')).toBe(true);
        expect(after.players.filter(p => p.team === 'home' && p.human)).toHaveLength(1);
    }
});
