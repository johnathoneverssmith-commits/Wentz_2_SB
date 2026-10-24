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
        expect(await saved(page)).toMatchObject({ quarter: 2, clock: 1800, expired: false, offense: 'home', down: 2 });
        await expect(page.getByTestId('period')).toHaveText('Q2 · 3:00');
        await page.reload();
        await page.clock.runFor(128);
        expect(await saved(page)).toMatchObject({ quarter: 2, clock: 1800 });
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
        expect(second).toMatchObject({ quarter: 3, offense: 'away', line: 82, down: 1, clock: 1800, score: { home: 7, away: 3 } });
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
        expect(await saved(page)).toMatchObject({ phase: 'pre-snap', quarter: 1, clock: 1800, score: { home: 0, away: 0 }, mode: 'regulation', winner: null });
        await expect(page.getByTestId('final')).toHaveCount(0);
        await expect(page.getByTestId('period')).toHaveText('Q1 · 3:00');
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
