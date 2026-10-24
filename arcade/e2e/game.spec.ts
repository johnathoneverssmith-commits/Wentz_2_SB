import { test, expect } from './fixtures';
import { lineUp } from '../core/down';
import { isGood } from '../core/kick';
import { button, kickBadly, kickCentred, nextDown, play, saved, startClocked, text } from './helpers';

test.setTimeout(120_000);

/** A meter press that is accurate enough for a 27-yard kick but not for a 57-yard one. */
const SHORT_ONLY = 35;

test.describe('field goals and extra points', () => {
    test('the kick meter decides: a centred press is good, the first instant is no good, and the point after is worth one', async ({ page }) => {
        await startClocked(page, lineUp('home', 107));
        const td = await play(page, ['KeyD']);
        expect(td.result?.touchdown).toBe(true);
        await nextDown(page);
        expect(await text(page, 'situation')).toBe('Extra point');
        expect(await text(page, 'headline')).toContain('stop the meter in the green');
        const miss = await kickBadly(page, 'KeyG');
        expect(miss.kick).toMatchObject({ good: false, lockedAt: 0 });
        expect(miss.score).toEqual({ home: 6, away: 0 });
        expect(await text(page, 'headline')).toBe('Extra point is no good');
        await nextDown(page);
        expect(await saved(page)).toMatchObject({ offense: 'away', line: 82, score: { home: 6, away: 0 } });
    });
    test('a field goal cannot be chosen from out of range', async ({ page }) => {
        await startClocked(page, lineUp('home', 38, { down: 4 }));
        const disabled = () => page.getByLabel('Play', { exact: true }).evaluate((select: HTMLSelectElement) => select.querySelector<HTMLOptionElement>('option[value="fieldgoal"]')!.disabled);
        expect(await disabled()).toBe(true);
        await page.reload();
        await page.clock.runFor(128);
        expect(await disabled()).toBe(true);
        // Nothing but the menu offers the kick: choosing it directly changes nothing.
        expect((await saved(page)).play).toBe('rush');
    });
    test('the same press is good from 27 yards and no good from 57: difficulty follows distance', async ({ browser }) => {
        expect(isGood(SHORT_ONLY, 27)).toBe(true);
        expect(isGood(SHORT_ONLY, 57)).toBe(false);
        for (const [line, expectGood] of [[100, true], [70, false]] as const) {
            const context = await browser.newContext();
            const fresh = await context.newPage();
            await startClocked(fresh, lineUp('home', line, { down: 4 }));
            await fresh.getByLabel('Play', { exact: true }).selectOption('fieldgoal');
            await expect(button(fresh, 'Kick field goal')).toBeVisible();
            await button(fresh, 'Kick field goal').click();
            const kick = (await saved(fresh)).kick!;
            expect(kick.kind).toBe('fg');
            expect(kick.distance).toBe(110 - line + 17);
            while ((await saved(fresh)).kick!.ticks < SHORT_ONLY) await fresh.clock.runFor(16);
            await fresh.keyboard.press('KeyG');
            const done = await saved(fresh);
            expect(done.kick!.good, `line ${line}`).toBe(expectGood);
            expect(done.score.home).toBe(expectGood ? 3 : 0);
            expect(await text(fresh, 'headline')).toBe(expectGood ? 'Field goal is good! Bluebirds +3' : 'Field goal is no good');
            await nextDown(fresh);
            const next = await saved(fresh);
            if (expectGood) expect(next).toMatchObject({ offense: 'away', line: 82 });
            else expect(next).toMatchObject({ offense: 'away', line: 70 });
            await context.close();
        }
    });
    test('reloading during the meter, after the kick and while waiting for Next down never scores or skips', async ({ page }) => {
        await startClocked(page, lineUp('away', 25, { down: 4 }));
        await page.getByLabel('Play', { exact: true }).selectOption('fieldgoal');
        await button(page, 'Kick field goal').click();
        await page.clock.runFor(400);
        const swinging = await saved(page);
        expect(swinging.kick!.good).toBeNull();
        await page.reload();
        await page.clock.runFor(256);
        expect(await saved(page)).toEqual(swinging);
        await expect(page.getByTestId('phase')).toHaveText('Paused');
        await button(page, 'Resume').click();
        const kicked = await kickCentred(page, 'Quote');
        expect(kicked.kick!.good).toBe(true);
        expect(kicked.score).toEqual({ home: 0, away: 3 });
        for (let i = 0; i < 3; i++) {
            await page.reload();
            await page.clock.runFor(256);
            expect(await saved(page)).toEqual(kicked);
        }
        await nextDown(page);
        await page.reload();
        await page.clock.runFor(256);
        const next = await saved(page);
        expect(next).toMatchObject({ offense: 'home', line: 38, score: { home: 0, away: 3 }, phase: 'pre-snap' });
    });
});

test.describe('quarters, halftime, overtime and the final score', () => {
    test('the game clock moves only while a play is live: not when paused, between downs, during a kick or across a reload', async ({ page }) => {
        await startClocked(page, lineUp('home', 40, { game: { clock: 6000 } }));
        await page.keyboard.press('Enter');
        await page.keyboard.down('KeyD');
        await page.clock.runFor(200);
        const running = await saved(page);
        expect(running.clock).toBeLessThan(6000);
        expect(running.clock).toBeGreaterThan(6000 - 20);
        await button(page, 'Pause').click();
        await page.keyboard.up('KeyD');
        const paused = await saved(page);
        await page.clock.runFor(8000);
        expect((await saved(page)).clock).toBe(paused.clock);
        for (let i = 0; i < 2; i++) {
            await page.reload();
            await page.clock.runFor(3000);
            expect((await saved(page)).clock, 'reloading and waiting does not consume game time').toBe(paused.clock);
        }
        await button(page, 'Resume').click();
        await page.keyboard.down('KeyD');
        for (let i = 0; i < 40 && (await saved(page)).phase === 'live'; i++) await page.clock.runFor(100);
        await page.keyboard.up('KeyD');
        const dead = await saved(page);
        expect(dead.phase).toBe('dead');
        expect(dead.clock).toBeLessThan(paused.clock);
        await page.clock.runFor(10_000);
        expect((await saved(page)).clock, 'a finished down does not run the clock').toBe(dead.clock);
        await nextDown(page);
        await page.clock.runFor(10_000);
        expect((await saved(page)).clock, 'the next snap waits for the players').toBe(dead.clock);
    });
    test('the kick meter does not run the clock either', async ({ page }) => {
        await startClocked(page, lineUp('home', 100, { down: 4, game: { clock: 4000 } }));
        await page.getByLabel('Play', { exact: true }).selectOption('fieldgoal');
        await page.keyboard.press('Enter');
        await page.clock.runFor(1500);
        const k = await saved(page);
        expect(k.phase).toBe('kick');
        expect(k.clock).toBe(4000);
        expect(k.kick!.ticks).toBeGreaterThan(50);
    });
    test('a quarter ends after the play in progress finishes, then Q2 starts with a full clock and the same ball', async ({ page }) => {
        await startClocked(page, lineUp('home', 40, { game: { clock: 8 } }));
        await expect(page.getByTestId('period')).toHaveText('Q1 · 0:01');
        await expect(page.getByTestId('clock')).toHaveText('0:01');
        await page.keyboard.press('Enter');
        await page.keyboard.down('KeyD');
        await page.clock.runFor(200);
        expect((await saved(page)).clock).toBe(0);
        await page.clock.runFor(120);
        await expect(page.getByTestId('clock-note')).toHaveText('Time: the quarter ends after this play');
        expect((await saved(page)).phase, 'the play is allowed to finish').not.toBe('pre-snap');
        for (let i = 0; i < 40 && (await saved(page)).phase === 'live'; i++) await page.clock.runFor(100);
        await page.keyboard.up('KeyD');
        const dead = await saved(page);
        expect(dead).toMatchObject({ phase: 'dead', quarter: 1, expired: true });
        expect(await text(page, 'next-situation')).toContain('Q2 begins');
        await nextDown(page);
        expect(await saved(page)).toMatchObject({ quarter: 2, clock: 10800, expired: false, offense: 'home', down: 2 });
        await expect(page.getByTestId('period')).toHaveText('Q2 · 3:00');
        await page.reload();
        await page.clock.runFor(128);
        expect(await saved(page)).toMatchObject({ quarter: 2, clock: 10800 });
    });
    test('halftime gives the second-half ball to Orange, which did not open, and reloading cannot skip or repeat it', async ({ page }) => {
        await startClocked(page, lineUp('home', 60, { game: { quarter: 2, clock: 8 }, score: { home: 7, away: 3 } }));
        await play(page, ['KeyD']);
        expect(await text(page, 'next-situation')).toContain('second half begins');
        await page.reload();
        await page.clock.runFor(128);
        expect(await saved(page)).toMatchObject({ phase: 'dead', quarter: 2, expired: true });
        await nextDown(page);
        const second = await saved(page);
        expect(second).toMatchObject({ quarter: 3, offense: 'away', line: 82, down: 1, clock: 10800, score: { home: 7, away: 3 } });
        for (let i = 0; i < 2; i++) {
            await page.reload();
            await page.clock.runFor(128);
            expect(await saved(page)).toEqual(second);
        }
        await expect(page.getByTestId('period')).toHaveText('Q3 · 3:00');
    });
    test('a tie at the end of regulation goes to overtime: each team gets a possession from its own 28, scores are compared after both', async ({ page }) => {
        await startClocked(page, lineUp('home', 40, { game: { quarter: 4, clock: 8 }, score: { home: 7, away: 7 } }));
        await play(page, ['KeyD']);
        expect(await text(page, 'next-situation')).toContain('overtime begins');
        await nextDown(page);
        expect(await saved(page)).toMatchObject({ mode: 'overtime', quarter: 5, offense: 'away', line: 82, down: 1, clock: 0, score: { home: 7, away: 7 } });
        await expect(page.getByTestId('period')).toHaveText('Overtime');
        await expect(page.getByTestId('clock')).toHaveCount(0);
        // Foxes march left and score; Orange keeps the ball for the point after.
        await page.reload();
        await page.clock.runFor(128);
        expect((await saved(page)).mode).toBe('overtime');
    });
    test('overtime to a winner: the first team scores, the second team fails on downs, the final screen names the winner and a rematch starts fresh', async ({ page }) => {
        await startClocked(page, lineUp('away', 13, { game: { mode: 'overtime', quarter: 5, clock: 0, overtime: { first: 'away', possessions: 0 } }, score: { home: 7, away: 7 } }));
        const td = await play(page, ['ArrowLeft']);
        expect(td.result?.touchdown).toBe(true);
        await nextDown(page);
        const xp = await kickCentred(page, 'Quote');
        expect(xp.score).toEqual({ home: 7, away: 14 });
        await nextDown(page);
        expect(await saved(page)).toMatchObject({ mode: 'overtime', offense: 'home', line: 38, down: 1, overtime: { possessions: 1 } });
        await page.reload();
        await page.clock.runFor(128);
        expect(await saved(page)).toMatchObject({ offense: 'home', overtime: { possessions: 1 } });
        for (let down = 1; down <= 4; down++) {
            await play(page);
            if (down < 4) await nextDown(page);
        }
        expect(await text(page, 'next-situation')).toBe('Final: Foxes win');
        await nextDown(page);
        const over = await saved(page);
        expect(over).toMatchObject({ phase: 'final', mode: 'final', winner: 'away', score: { home: 7, away: 14 } });
        await expect(page.getByTestId('final')).toBeVisible();
        expect(await text(page, 'final-headline')).toBe('Final: Foxes win');
        expect(await text(page, 'final-score')).toBe('Bluebirds 7 – 14 Foxes');
        // The game is frozen: keys and buttons do nothing, and a reload shows the same final.
        for (const key of ['Enter', 'KeyD', 'KeyG', 'KeyQ']) await page.keyboard.press(key);
        await page.clock.runFor(1000);
        expect(await saved(page)).toEqual(over);
        for (let i = 0; i < 3; i++) {
            await page.reload();
            await page.clock.runFor(128);
            expect(await saved(page)).toEqual(over);
            await expect(page.getByTestId('final')).toBeVisible();
        }
        await button(page, 'Rematch').click();
        expect(await saved(page)).toMatchObject({ phase: 'pre-snap', quarter: 1, clock: 10800, score: { home: 0, away: 0 }, mode: 'regulation', winner: null });
        await expect(page.getByTestId('final')).toHaveCount(0);
        await expect(page.getByTestId('period')).toHaveText('Q1 · 3:00');
    });
    test('a tied overtime has no round limit: past the old five-pair mark the game goes on, survives a reload and ends only with a winner', async ({ page }) => {
        // Eleven possessions are done (five tied pairs and Foxes' sixth); Bluebirds have the ball for the twelfth.
        await startClocked(page, lineUp('home', 38, { down: 4, score: { home: 9, away: 9 }, game: { mode: 'overtime', quarter: 5, clock: 0, overtime: { first: 'away', possessions: 11 } } }));
        await play(page);
        await nextDown(page);
        const next = await saved(page);
        expect(next).toMatchObject({ mode: 'overtime', phase: 'pre-snap', offense: 'away', line: 82, winner: null, overtime: { first: 'away', possessions: 12 }, score: { home: 9, away: 9 } });
        await expect(page.getByTestId('final')).toHaveCount(0);
        await page.reload();
        await page.clock.runFor(128);
        expect(await saved(page)).toEqual(next);
    });
    test('a tied overtime ends in a winner whenever one finally scores: the sixth pair, Bluebirds touchdown and point after', async ({ page }) => {
        await startClocked(page, lineUp('home', 107, { score: { home: 9, away: 9 }, game: { mode: 'overtime', quarter: 5, clock: 0, overtime: { first: 'away', possessions: 11 } } }));
        const td = await play(page, ['KeyD']);
        expect(td.result?.touchdown).toBe(true);
        await nextDown(page);
        await kickCentred(page, 'KeyG');
        expect(await text(page, 'next-situation')).toBe('Final: Bluebirds win');
        await nextDown(page);
        expect(await saved(page)).toMatchObject({ phase: 'final', winner: 'home', score: { home: 16, away: 9 }, overtime: { possessions: 11 } });
        await expect(page.getByTestId('final-score')).toHaveText('Bluebirds 16 – 9 Foxes');
        await page.reload();
        await page.clock.runFor(128);
        await expect(page.getByTestId('final')).toBeVisible();
    });
    test('the leader wins at the end of regulation, and the final screen appears once', async ({ page }) => {
        await startClocked(page, lineUp('home', 40, { game: { quarter: 4, clock: 8 }, score: { home: 10, away: 3 } }));
        await play(page, ['KeyD']);
        expect(await text(page, 'next-situation')).toBe('Final: Bluebirds win');
        await nextDown(page);
        await expect(page.getByTestId('final')).toBeVisible();
        expect(await text(page, 'final-headline')).toBe('Final: Bluebirds win');
        const over = await saved(page);
        expect(over.terminalCount).toBeGreaterThan(0);
        await page.reload();
        await page.clock.runFor(128);
        expect(await saved(page)).toEqual(over);
    });
});
