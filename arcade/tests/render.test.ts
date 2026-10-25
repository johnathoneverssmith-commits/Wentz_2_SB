import { describe, expect, it } from 'vitest';
import { clampCamera, followCamera, HALF_VIEW, viewLeftPx } from '../browser/render/camera';
import { drawable, textWidth } from '../browser/render/font';
import { fieldPosition, downText, periodText, TEAM_NAMES } from '../browser/render/hud';
import { identityOf, positionOf } from '../browser/render/roster';
import { ANIMS, frameCount, frameIndex } from '../browser/render/sprites';
import { createDown, lineUp } from '../core/down';

describe('render: camera', () => {
    it('never shows beyond the scenery strips, however far the target is', () => {
        for (const x of [-50, 0, 60, 120, 400]) {
            const c = clampCamera(x);
            expect(c - HALF_VIEW).toBeGreaterThanOrEqual(-6);
            expect(c + HALF_VIEW).toBeLessThanOrEqual(126);
        }
    });
    it('moves smoothly toward a target, in the same way at any frame rate, without overshooting', () => {
        let a = 30, b = 30;
        for (let i = 0; i < 60; i++) a = followCamera(a, 50, 1 / 60);
        for (let i = 0; i < 30; i++) b = followCamera(b, 50, 1 / 30);
        expect(a).toBeCloseTo(b, 6);
        expect(a).toBeLessThanOrEqual(50);
        expect(a).toBeGreaterThan(40);
        let prev = 30;
        for (let i = 0; i < 200; i++) { const n = followCamera(prev, 50, 1 / 60); expect(n).toBeGreaterThanOrEqual(prev); expect(n - prev).toBeLessThan(2); prev = n; }
    });
    it('cuts instead of panning across the field for a huge jump, and is exact once settled', () => {
        expect(followCamera(20, 100, 1 / 60)).toBe(clampCamera(100));
        expect(followCamera(50, 50, 1 / 60)).toBe(50);
    });
    it('is pure and pixel-aligned', () => {
        expect(followCamera(40, 55, 0.016)).toBe(followCamera(40, 55, 0.016));
        expect(Number.isInteger(viewLeftPx(41.37))).toBe(true);
    });
});
describe('render: sprites and animation', () => {
    it('every animation has frames and a positive rate; looping ones wrap and one-shots hold', () => {
        for (const [name, def] of Object.entries(ANIMS)) {
            expect(def.poses.length, name).toBeGreaterThan(0);
            expect(def.fps, name).toBeGreaterThan(0);
        }
        for (const anim of ['idle', 'run', 'block', 'celebrate'] as const) expect(frameIndex(anim, 100)).toBeLessThan(frameCount(anim));
        expect(frameIndex('fall', 0)).toBe(0);
        expect(frameIndex('fall', 10)).toBe(frameCount('fall') - 1);
        expect(frameIndex('throw', 10)).toBe(frameCount('throw') - 1);
        expect(frameIndex('idle', 0)).toBe(0);
    });
    it('provides every animation the milestone asks for', () => {
        expect(Object.keys(ANIMS).sort()).toEqual(['block', 'catch', 'celebrate', 'fall', 'idle', 'kick', 'run', 'tackle', 'throw']);
    });
});
describe('render: identity and labels', () => {
    it('ids are persistent and every player has a name, a skin tone and a position on both sides of the ball', () => {
        const names = new Set<string>();
        for (const team of ['home', 'away'] as const)
            for (const n of [1, 2, 3, 4, 5] as const) {
                const id = identityOf(`${team}-${n}`);
                expect(id.id).toBe(`${team}-${n}`);
                expect(id.name.length).toBeGreaterThan(2);
                expect(drawable(id.name)).toBe(true);
                names.add(id.name);
                expect(positionOf(n, true)).not.toBe('');
                expect(positionOf(n, false)).not.toBe('');
            }
        expect(names.size).toBe(10);
        expect(positionOf(1, true)).toBe('QB');
    });
});
describe('render: scoreboard text', () => {
    it('labels the field by side, with the fifty in the middle', () => {
        expect(fieldPosition(38)).toBe('BLU 28');
        expect(fieldPosition(60)).toBe('50');
        expect(fieldPosition(82)).toBe('FOX 28');
        expect(fieldPosition(105)).toBe('FOX 5');
    });
    it('draws only characters the pixel font has, for every state of a game', () => {
        for (const s of [createDown(), lineUp('away', 82, { down: 3 }), lineUp('home', 108, { down: 4 })]) {
            for (const t of [downText(s), periodText(s), fieldPosition(s.line)]) expect(drawable(t), t).toBe(true);
        }
        for (const t of Object.values(TEAM_NAMES)) expect(drawable(t)).toBe(true);
        expect(textWidth('AB', 2)).toBe(14);
    });
});
