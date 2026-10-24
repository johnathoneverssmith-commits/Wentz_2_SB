import { expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
import { encodeSave } from '../browser/save';

export const SAVE_KEY = 'wentz.arcade.down.v1';
export const saved = (page: Page): Promise<DownState> => page.evaluate(() => JSON.parse(localStorage.getItem('wentz.arcade.down.v1')!).state);
export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const text = (page: Page, id: string) => page.getByTestId(id).innerText();

/** Time is the only thing controlled: keyboard events, React, animation frames and saving are real. */
export async function startClocked(page: Page, seed?: DownState, options: { frameMs?: number } = {}) {
    if (options.frameMs) {
        // A slow screen: the page draws every `frameMs` of game-clock time instead of every 16 ms. The simulation still
        // steps at 1/60 s (the app catches up at most 100 ms per frame), so this is the same game on a slower machine.
        await page.addInitScript(ms => {
            window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), ms) as unknown as number;
            window.cancelAnimationFrame = id => window.clearTimeout(id);
        }, options.frameMs);
    }
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5184' ? route.continue() : route.abort());
    if (seed) {
        const body = encodeSave(seed);
        // Loading a save is the app's own feature: this is a prepared save, not a hook into the running game.
        await page.addInitScript(([key, value]) => { if (!localStorage.getItem(key as string)) localStorage.setItem(key as string, value as string); }, [SAVE_KEY, body]);
    }
    await page.clock.install({ time: new Date('2026-10-25T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-25T12:00:00Z'));
    await page.goto('/');
    await page.clock.runFor(128);
}
/** Snap, hold the given keys while the play runs to its end, release, and return the finished snapshot. */
export async function play(page: Page, keys: string[] = [], runMs = 200): Promise<DownState> {
    await page.keyboard.press('Enter');
    for (const key of keys) await page.keyboard.down(key);
    for (let waited = 0; waited < 16_000 && (await saved(page)).phase === 'live'; waited += runMs)
        await page.clock.runFor(runMs);
    for (const key of keys) await page.keyboard.up(key);
    const dead = await saved(page);
    expect(dead.phase, 'the play should have ended').toBe('dead');
    return dead;
}
export const nextDown = async (page: Page) => { await page.keyboard.press('Enter'); await page.clock.runFor(32); };
/** Waits for the kick meter to cross the centre (a quarter or three quarters of a swing) and presses the team's key. */
export async function kickCentred(page: Page, key: 'KeyG' | 'Quote'): Promise<DownState> {
    for (let i = 0; i < 400; i++) {
        const k = (await saved(page)).kick;
        if (!k) throw new Error('no kick in progress');
        if (k.good !== null) break;
        const phase = k.ticks % 100;
        if (Math.abs(phase - 25) <= 2 || Math.abs(phase - 75) <= 2) { await page.keyboard.press(key); break; }
        await page.clock.runFor(16);
    }
    return saved(page);
}
/** Presses the kick key at the very start of the swing: the far end of the meter, a miss. */
export async function kickBadly(page: Page, key: 'KeyG' | 'Quote'): Promise<DownState> {
    await page.keyboard.press(key);
    return saved(page);
}
