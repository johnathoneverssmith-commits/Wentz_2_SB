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
