import { test, expect } from './fixtures';
import { startClocked } from './helpers';

test('long kicks show the kicker at setup and the ball at the posts for both teams', async ({ page }) => {
    await startClocked(page);
    const results = await page.evaluate(async () => {
        const rendererPath = '/browser/field.ts', corePath = '/core/down.ts';
        const { Renderer } = await import(rendererPath);
        const { lineUp, snap } = await import(corePath);
        return ['home', 'away'].map(team => {
            const s = snap(lineUp(team, team === 'home' ? 70 : 50, { play: 'fieldgoal' }));
            const r = new Renderer(), c = document.createElement('canvas'), ctx = c.getContext('2d')!;
            const sprites: number[] = [], balls: number[] = [];
            const drawImage = ctx.drawImage.bind(ctx), fillRect = ctx.fillRect.bind(ctx);
            ctx.drawImage = (...args: any[]) => {
                if (args.length === 3) {
                    const m = ctx.getTransform();
                    sprites.push(Math.min(m.transformPoint({ x: args[1], y: args[2] }).x, m.transformPoint({ x: args[1] + args[0].width, y: args[2] }).x));
                }
                (drawImage as any)(...args);
            };
            ctx.fillRect = (x, y, w, h) => { if (ctx.fillStyle === '#9a4f22') balls.push(x); fillRect(x, y, w, h); };
            // Remove ordinary players so only the stand-in kicker and kick ball are measured.
            const scene = { ...s, players: [] };
            r.draw(c, scene, false, 100);
            for (let t = 116; t <= 2100; t += 16) r.draw(c, scene, false, t);
            const kicker = sprites.at(-1)!;
            const kicked = { ...scene, kick: { ...s.kick, good: true, lockedAt: 25 } };
            r.draw(c, kicked, false, 2116);
            for (let t = 2132; t <= 4116; t += 16) r.draw(c, kicked, false, t);
            return { kicker, ball: balls.at(-1)! };
        });
    });
    for (const r of results) {
        expect(r.kicker).toBeGreaterThanOrEqual(0);
        expect(r.kicker).toBeLessThan(446);
        expect(r.ball).toBeGreaterThan(0);
        expect(r.ball).toBeLessThan(474);
    }
});

test('extra-point visuals do not depend on the touchdown starting line', async ({ page }) => {
    await startClocked(page);
    const equal = await page.evaluate(async () => {
        const rendererPath = '/browser/field.ts', corePath = '/core/down.ts';
        const { Renderer } = await import(rendererPath);
        const { lineUp } = await import(corePath);
        return ['home', 'away'].every(team => {
            const pictures = [38, 100].map(spot => {
                const s = { ...lineUp(team, 60), phase: 'kick', players: [], kick: { kind: 'xp', team, distance: 25, spot, ticks: 0, good: null, lockedAt: null } };
                const c = document.createElement('canvas');
                new Renderer().draw(c, s, false, 100);
                return c.toDataURL();
            });
            return pictures[0] === pictures[1];
        });
    });
    expect(equal).toBe(true);
});

test('pausing freezes the kick animation and resumes without consuming the pause', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startClocked(page);
    const result = await page.evaluate(async () => {
        const rendererPath = '/browser/field.ts', corePath = '/core/down.ts';
        const { Renderer } = await import(rendererPath);
        const { lineUp, snap } = await import(corePath);
        const s = snap(lineUp('home', 90, { play: 'fieldgoal' }));
        const c = document.createElement('canvas'), r = new Renderer();
        r.draw(c, s, false, 100);
        const kicked = { ...s, kick: { ...s.kick, good: true, lockedAt: 25 } };
        r.draw(c, kicked, false, 116);
        r.draw(c, kicked, true, 132);
        const first = c.toDataURL();
        r.draw(c, kicked, true, 5132);
        const second = c.toDataURL();
        r.draw(c, kicked, false, 5148);
        const resumed = c.toDataURL();
        const control = document.createElement('canvas'), other = new Renderer();
        other.draw(control, s, false, 100);
        other.draw(control, kicked, false, 116);
        other.draw(control, kicked, false, 132);
        return { frozen: first === second, resumed: resumed === control.toDataURL() };
    });
    expect(result).toEqual({ frozen: true, resumed: true });
});
