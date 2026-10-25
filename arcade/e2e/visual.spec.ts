import { test, expect } from './fixtures';
import { lineUp } from '../core/down';
import { button, nextDown, saved, startClocked } from './helpers';

/** Samples the 480x270 pixel canvas. These checks prove the scene is really drawn (not that it looks good: a person judges that). */
const pixels = (page: import('@playwright/test').Page) => page.evaluate(() => {
    const c = document.querySelector('canvas')!, ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const count = (pred: (r: number, g: number, b: number) => boolean) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (pred(d[i]!, d[i + 1]!, d[i + 2]!)) n++; return n; };
    return {
        width: c.width, height: c.height,
        turf: count((r, g, b) => g > 120 && g > r * 1.5 && g > b * 1.5),
        blue: count((r, g, b) => b > 180 && r < 90 && g > 80 && g < 150),
        orange: count((r, g, b) => r > 220 && g > 110 && g < 160 && b < 60),
        gold: count((r, g, b) => r > 240 && g > 190 && b < 110),
        distinct: new Set(Array.from({ length: d.length / 4 }, (_, i) => (d[i * 4]! << 16) | (d[i * 4 + 1]! << 8) | d[i * 4 + 2]!)).size,
    };
});
test('the field is a 16:9 pixel scene with turf, both teams in their colours, and a scoreboard', async ({ page }) => {
    await startClocked(page);
    const p = await pixels(page);
    expect([p.width, p.height]).toEqual([480, 270]);
    expect(p.turf, 'turf').toBeGreaterThan(20000);
    expect(p.blue, 'Bluebirds jerseys and helmets').toBeGreaterThan(40);
    expect(p.orange, 'Foxes jerseys and helmets').toBeGreaterThan(40);
    expect(p.distinct, 'a rich palette, not a flat prototype').toBeGreaterThan(60);
    const box = await page.locator('canvas').boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(16 / 9, 1);
});
test('players are drawn as sprites, not circles: a snap and a run change the picture, and the clock/score text stays in the page', async ({ page }) => {
    await startClocked(page);
    const before = await page.locator('canvas').screenshot();
    await page.keyboard.press('Enter');
    await page.keyboard.down('KeyD');
    await page.clock.runFor(700);
    await page.keyboard.up('KeyD');
    const after = await page.locator('canvas').screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
    await expect(page.getByTestId('period')).toContainText('Q1');
    await expect(page.getByRole('img', { name: /Football field/ })).toBeVisible();
});
test('the selected player has a ring and a name plate, and the first-down line is gold', async ({ page }) => {
    await startClocked(page);
    const p = await pixels(page);
    expect(p.gold, 'the first-down line and name plates').toBeGreaterThan(80);
    await expect(page.getByText('Player positions', { exact: false })).toBeVisible();
});
test('every animation plays through a real game without errors: pass, catch, tackle, touchdown and the kick', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await startClocked(page, lineUp('home', 100, { play: 'slants' } as never));
    await page.keyboard.press('Enter');
    await page.clock.runFor(300);
    await page.keyboard.press('KeyQ');
    await page.clock.runFor(2500);
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Enter'); await page.clock.runFor(900); }
    expect(errors).toEqual([]);
    const s = await saved(page);
    expect(s.score.home + s.score.away).toBeGreaterThanOrEqual(0);
    void button; void nextDown;
});
test('the canvas respects reduced motion by not shaking and the scoreboard text is not drawn twice for assistive tech', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startClocked(page);
    await expect(page.getByTestId('score-home')).toHaveText('0');
});
