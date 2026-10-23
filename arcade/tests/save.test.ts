import { expect, it } from 'vitest';
import { encodeSave, decodeSave, SAVE_KEY } from '../browser/save';
import { createDown, lineUp, nextDown, snap, stepDown } from '../core/down';
it('round trips an arcade snapshot, rejects corrupt saves and never uses a franchise key', () => {
    const state = snap(createDown());
    expect(decodeSave(encodeSave(state))).toEqual(state);
    expect(SAVE_KEY).toBe('wentz.arcade.down.v1');
    for (const bad of ['bad', '{}', JSON.stringify({ ...state, players: [] }), encodeSave({ ...state, line: NaN })])
        expect(decodeSave(bad)).toBeNull();
});
it('migrates v1 airborne and completed saves without losing prior completions', () => {
    for (const current of [createDown(), snap(createDown())]) {
        const { terminalCount, contestUntil, ...old } = current;
        const later = { ...old, playNumber: 4 };
        expect(decodeSave(JSON.stringify({ version: 1, state: later }))).toMatchObject({ phase: current.phase, playNumber: 4, terminalCount: 3 });
    }
    const { terminalCount, contestUntil, ...old } = snap(createDown());
    const live = { ...old, playNumber: 4 };
    const dead = { ...live, phase: 'dead', result: { playNumber: 4, reason: 'tackle', yards: 2.5, turnover: false, touchdown: false } };
    expect(decodeSave(JSON.stringify({ version: 1, state: dead }))).toMatchObject({ playNumber: 4, terminalCount: 4, result: dead.result });
});

const MID = 26.66666666665;
const scoredHome = () => {
    let s = snap(lineUp('home', 100, { score: { home: 7, away: 3 }, down: 3 }));
    s = { ...s, players: s.players.map(p => p.id === s.possession.carrier ? { ...p, x: 109.95, y: MID } : p.team !== 'home' ? { ...p, x: 30, y: 5 } : p) };
    return stepDown(s, { home: { x: 1, y: 0 }, away: { x: 0, y: 0 } });
};
/** What a version-2 browser wrote: no score, down or marker, and a result without the drive flags. */
const asVersion2 = (state: unknown) => {
    const { score, down, firstDownLine, ...rest } = state as Record<string, unknown> & { result: Record<string, unknown> | null };
    const result = rest.result ? (({ firstDown, turnoverOnDowns, ...r }) => r)(rest.result as Record<string, unknown> & { firstDown: boolean; turnoverOnDowns: boolean }) : null;
    return JSON.stringify({ version: 2, state: { ...rest, result } });
};
it('round trips score, down, marker and the drive flags in version 3', () => {
    const dead = scoredHome();
    expect(dead.score).toEqual({ home: 13, away: 3 });
    expect(JSON.parse(encodeSave(dead)).version).toBe(3);
    expect(decodeSave(encodeSave(dead))).toEqual(dead);
    const live = snap(lineUp('away', 70, { down: 3, score: { home: 1, away: 2 } }));
    expect(decodeSave(encodeSave(live))).toEqual(live);
});
it('migrates a version-2 completed touchdown by scoring it exactly once, and starts down and marker fresh', () => {
    const dead = scoredHome();
    const old = decodeSave(asVersion2({ ...dead, score: { home: 0, away: 0 } }))!;
    expect(old.score).toEqual({ home: 6, away: 0 });
    expect(old).toMatchObject({ down: 1, firstDownLine: 110, phase: 'dead', result: { touchdown: true, firstDown: false, turnoverOnDowns: false } });
    const again = decodeSave(encodeSave(old))!;
    expect(again).toEqual(old);
    expect(nextDown(again).score).toEqual({ home: 6, away: 0 });
});
it('migrates a version-2 safety and a plain live down without inventing points', () => {
    let s = snap(lineUp('home', 14));
    s = { ...s, players: s.players.map(p => p.id === s.possession.carrier ? { ...p, x: 10.05, y: MID } : p.team !== 'home' ? { ...p, x: 100, y: 5 } : p) };
    const safety = stepDown(s, { home: { x: -1, y: 0 }, away: { x: 0, y: 0 } });
    expect(decodeSave(asVersion2({ ...safety, score: { home: 0, away: 0 } }))!.score).toEqual({ home: 0, away: 2 });
    const live = snap(createDown());
    expect(decodeSave(asVersion2(live))).toMatchObject({ score: { home: 0, away: 0 }, down: 1, firstDownLine: 48, phase: 'live' });
});
it('reloading a scored down never scores again: the snapshot, Next down and a second Next down agree on the score', () => {
    const dead = scoredHome();
    for (let reload = 0; reload < 3; reload++) {
        const restored = decodeSave(encodeSave(dead))!;
        expect(restored).toEqual(dead);
        expect(stepDown(restored, { home: { x: 1, y: 0 }, away: { x: 0, y: 0 } })).toBe(restored);
        const next = nextDown(restored);
        expect(next.score).toEqual({ home: 13, away: 3 });
        expect(nextDown(next)).toBe(next);
    }
});
it('rejects impossible drive state', () => {
    const state = snap(createDown());
    for (const bad of [{ down: 5 }, { down: 0 }, { score: { home: -1, away: 0 } }, { score: { home: 1.5, away: 0 } }, { score: null }, { firstDownLine: 5 }, { firstDownLine: Number.NaN }])
        expect(decodeSave(JSON.stringify({ version: 3, state: { ...state, ...bad } }))).toBeNull();
    const dead = scoredHome();
    expect(decodeSave(JSON.stringify({ version: 3, state: { ...dead, result: { ...dead.result, firstDown: undefined } } }))).toBeNull();
});
