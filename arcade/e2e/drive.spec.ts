import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
import { button, kickCentred, resume, saved, text } from './helpers';

test.setTimeout(120_000);
test.beforeEach(async ({ page }) => {
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5184' ? route.continue() : route.abort());
    // Only time is controlled: keyboard events, React, animation frames and saving are real.
    await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-23T12:01:00Z'));
    await page.goto('/');
    await page.clock.runFor(128);
});

/** Snap, hold the given keys while the play runs to its end, release, and leave the dead snapshot. */
async function play(page: Page, keys: string[] = [], runMs = 600): Promise<DownState> {
    await page.keyboard.press('Enter');
    for (const key of keys) await page.keyboard.down(key);
    // Run until the play ends (a blocked, idle carrier takes a few seconds to be caught); the limit is the 15 s play clock.
    for (let waited = 0; waited < 16_000 && (await saved(page)).phase === 'live'; waited += runMs)
        await page.clock.runFor(runMs);
    for (const key of keys) await page.keyboard.up(key);
    const dead = await saved(page);
    expect(dead.phase, 'the play should have ended').toBe('dead');
    return dead;
}
const nextDown = async (page: Page) => { await page.keyboard.press('Enter'); await page.clock.runFor(32); };

test('the scoreboard and the down and distance are on screen and follow the play', async ({ page }) => {
    expect(await text(page, 'situation')).toBe('1st & 10.0');
    expect([await text(page, 'score-home'), await text(page, 'score-away')]).toEqual(['0', '0']);
    const dead = await play(page, ['KeyD']);
    expect(dead.result?.firstDown).toBe(false);
    expect(await text(page, 'headline')).toBe('Play ended: tackle');
    expect(await text(page, 'next-situation')).toContain(`Bluebirds ball, 2nd & ${(10 - dead.result!.yards).toFixed(1)}`);
    await nextDown(page);
    expect(await text(page, 'situation')).toBe(`2nd & ${(10 - dead.result!.yards).toFixed(1)}`);
    await expect(page.getByText('Play 2 · Bluebirds ball')).toBeVisible();
    // Keep running: when a run reaches the marker the HUD announces the first down, and the next snap is 1st and 10 again.
    let gotFirst = false;
    for (let tries = 0; tries < 4 && !gotFirst; tries++) {
        const next = await play(page, ['KeyD']);
        if (next.result?.firstDown) {
            gotFirst = true;
            expect(await text(page, 'headline')).toBe('First down!');
        }
        await nextDown(page);
        if ((await saved(page)).offense !== 'home') break;
    }
    if (gotFirst) expect(await text(page, 'situation')).toBe('1st & 10.0');
});

test('an offense that goes nowhere hands the ball over on downs after four plays', async ({ page }) => {
    for (let down = 1; down <= 4; down++) {
        expect(await text(page, 'situation')).toMatch(new RegExp(`^${['1st', '2nd', '3rd', '4th'][down - 1]} & `));
        const dead = await play(page);
        expect(dead.result?.yards, 'a runner who stands still loses ground').toBeLessThanOrEqual(0);
        if (down < 4) await nextDown(page);
    }
    expect(await text(page, 'headline')).toBe('Turnover on downs');
    expect(await text(page, 'result'), 'a failed fourth down is a turnover on screen').toContain('Turnover: Yes');
    expect(await text(page, 'next-situation')).toMatch(/^Next: Foxes ball, 1st & /);
    await nextDown(page);
    expect(await text(page, 'situation')).toMatch(/^1st & /);
    await expect(page.getByText('Foxes ball', { exact: false }).first()).toBeVisible();
    const state = await saved(page);
    expect(state).toMatchObject({ offense: 'away', down: 1 });
    expect(state.score).toEqual({ home: 0, away: 0 });
});

test('a real drive scores six and the point after once, survives reloads and gives Orange the ball at its own 28', async ({ page }) => {
    let firstDowns = 0;
    for (let n = 0; n < 40; n++) {
        const dead = await play(page, ['KeyD']);
        if (dead.result!.firstDown) firstDowns++;
        if (dead.result!.touchdown) break;
        await nextDown(page);
    }
    expect(firstDowns).toBeGreaterThanOrEqual(4);
    const scored = await saved(page);
    expect(scored.result?.touchdown).toBe(true);
    expect(scored.score).toEqual({ home: 6, away: 0 });
    expect([await text(page, 'score-home'), await text(page, 'score-away')]).toEqual(['6', '0']);
    expect(await text(page, 'headline')).toBe('Touchdown! Bluebirds +6');
    const completed = scored.terminalCount;
    for (let reload = 0; reload < 3; reload++) {
        await page.reload();
        await page.clock.runFor(256);
        expect(await saved(page), 'reload must restore the scored down exactly').toEqual(scored);
        expect(await text(page, 'score-home')).toBe('6');
        expect(await page.getByTestId('terminal-count').innerText()).toBe(`Completed plays: ${completed}`);
    }
    await page.clock.runFor(3000);
    expect((await saved(page)).score).toEqual({ home: 6, away: 0 });
    await resume(page);
    // The touchdown goes to the extra point: Enter opens the kick, a reload keeps the meter where it was, and the kick scores once.
    await nextDown(page);
    const kicking = await saved(page);
    expect(kicking).toMatchObject({ phase: 'kick', kick: { kind: 'xp', team: 'home', good: null }, score: { home: 6, away: 0 } });
    await page.reload();
    await page.clock.runFor(256);
    expect((await saved(page)).kick).toMatchObject({ kind: 'xp', good: null });
    await expect(page.getByTestId('phase')).toHaveText('Paused');
    await button(page, 'Resume').click();
    const kicked = await kickCentred(page, 'KeyG');
    expect(kicked.kick).toMatchObject({ good: true });
    expect(kicked.score).toEqual({ home: 7, away: 0 });
    expect(await text(page, 'headline')).toBe('Extra point is good! Bluebirds +1');
    for (let reload = 0; reload < 2; reload++) {
        await page.reload();
        await page.clock.runFor(256);
        expect(await saved(page)).toEqual(kicked);
        expect([await text(page, 'score-home'), await text(page, 'score-away')]).toEqual(['7', '0']);
    }
    await nextDown(page);
    const next = await saved(page);
    expect(next).toMatchObject({ offense: 'away', down: 1, line: 82, phase: 'pre-snap', score: { home: 7, away: 0 } });
    expect(await text(page, 'situation')).toBe('1st & 10.0');
    await expect(page.getByText('Foxes ball', { exact: false }).first()).toBeVisible();
    await page.reload();
    await page.clock.runFor(256);
    expect((await saved(page)).score).toEqual({ home: 7, away: 0 });
    await resume(page);
    // Orange is now on offense: its own keys run the ball left and the scoreboard still reads 6-0.
    const orange = await play(page, ['ArrowLeft'], 1600);
    expect(orange.offense).toBe('away');
    expect(orange.result?.yards).toBeGreaterThan(0);
    expect(orange.score).toEqual({ home: 7, away: 0 });
});

test('a touchdown by Orange scores for Orange and Restart clears the scoreboard', async ({ page }) => {
    // Turn the ball over to Orange (idle offense x4), then Orange runs the drive in with its own keys.
    for (let down = 1; down <= 4; down++) {
        await play(page);
        await nextDown(page);
    }
    expect((await saved(page)).offense).toBe('away');
    for (let n = 0; n < 40; n++) {
        const dead = await play(page, ['ArrowLeft']);
        if (dead.result!.touchdown) break;
        await nextDown(page);
    }
    const scored = await saved(page);
    expect(scored.score).toEqual({ home: 0, away: 6 });
    expect(await text(page, 'headline')).toBe('Touchdown! Foxes +6');
    await button(page, 'Restart').click();
    expect((await saved(page)).score).toEqual({ home: 0, away: 0 });
    expect(await text(page, 'situation')).toBe('1st & 10.0');
});
