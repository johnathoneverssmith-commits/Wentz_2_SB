import { expect, it } from 'vitest';
import { encodeSave, decodeSave, SAVE_KEY } from '../browser/save';
import { createDown, snap } from '../core/down';
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
