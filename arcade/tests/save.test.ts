import { expect, it } from 'vitest';
import { encodeSave, decodeSave, SAVE_KEY } from '../browser/save';
import { BETWEEN_PLAY_TICKS, QUARTER_TICKS, choosePlay, createDown, kickBall, lineUp, nextDown, snap, stepDown } from '../core/down';
import { kickAtTick, CENTRE, expectOnlyClockMoved, tackled, touchdown } from './helpers';
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
it('round trips score, down, marker and the drive flags in the current version', () => {
    const dead = scoredHome();
    expect(dead.score).toEqual({ home: 13, away: 3 });
    expect(JSON.parse(encodeSave(dead)).version).toBe(5);
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
        expectOnlyClockMoved(stepDown(restored, { home: { x: 1, y: 0 }, away: { x: 0, y: 0 } }), restored);
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

/** What a version-3 browser wrote: everything but the game clock, quarter, kick and result fields. */
const asVersion3 = (state: unknown) => {
    const { quarter, clock, expired, mode, openingTeam, overtime, winner, kick, ...rest } = state as Record<string, unknown>;
    return JSON.stringify({ version: 3, state: rest });
};
it('migrates a version-3 drive into the first quarter of a new game with a full clock', () => {
    const old = decodeSave(asVersion3(snap(lineUp('home', 60, { down: 3, score: { home: 7, away: 3 } }))))!;
    expect(old).toMatchObject({ quarter: 1, clock: QUARTER_TICKS, expired: false, mode: 'regulation', openingTeam: 'home', winner: null, kick: null, down: 3, score: { home: 7, away: 3 }, phase: 'live' });
    expect(old.overtime).toEqual({ first: 'away', possessions: 0 });
    expect(decodeSave(encodeSave(old))).toEqual(old);
    // A completed touchdown in an old save still gets its extra point, exactly once.
    const dead = touchdown(lineUp('home', 100));
    const migrated = decodeSave(asVersion3(dead))!;
    expect(migrated.score).toEqual({ home: 6, away: 0 });
    const kick = nextDown(migrated);
    expect(kick.phase).toBe('kick');
    expect(nextDown(kickAtTick(kick, CENTRE)).score).toEqual({ home: 7, away: 0 });
});
it('round trips every game state: a swinging kick, a resolved kick, overtime, and a finished game', () => {
    const kicking = nextDown(touchdown(lineUp('home', 100)));
    const swinging = stepDown(stepDown(kicking, { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } }), { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } });
    expect(swinging.kick!.ticks).toBe(2);
    expect(decodeSave(encodeSave(swinging))).toEqual(swinging);
    const kicked = kickBall(swinging, 'home');
    expect(decodeSave(encodeSave(kicked))).toEqual(kicked);
    const field = snap(choosePlay(lineUp('away', 25, { down: 4 }), 'fieldgoal'));
    expect(decodeSave(encodeSave(field))).toEqual(field);
    expect(decodeSave(encodeSave(choosePlay(lineUp('home', 90), 'fieldgoal')))).toMatchObject({ play: 'fieldgoal' });
    const ot = lineUp('away', 82, { game: { mode: 'overtime', quarter: 5, clock: 0, overtime: { first: 'away', possessions: 1 } } });
    expect(decodeSave(encodeSave(ot))).toEqual(ot);
    const over = nextDown(lineUp('home', 40, { score: { home: 9, away: 3 }, game: { quarter: 4, clock: 0, expired: true } }) && stepDownToFinal());
    expect(over.phase).toBe('final');
    expect(decodeSave(encodeSave(over))).toEqual(over);
    const mid = lineUp('home', 40, { game: { quarter: 3, clock: 777, expired: false } });
    expect(decodeSave(encodeSave(mid))).toEqual(mid);
});
function stepDownToFinal() {
    // A finished game: the leader after the last play of the fourth quarter.
    const dead = stepDown(snap(lineUp('home', 40, { score: { home: 9, away: 3 }, game: { quarter: 4, clock: 1 } })), { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } });
    return dead.phase === 'live' ? (() => { let s = dead; while (s.phase === 'live') s = stepDown(s, { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } }); return s; })() : dead;
}
it('rejects game states that contradict themselves', () => {
    const state = snap(createDown());
    const bad = [
        { quarter: 0 }, { quarter: 6 }, { clock: -1 }, { clock: QUARTER_TICKS + 1 }, { clock: 1.5 }, { expired: 'yes' }, { mode: 'sudden' },
        { mode: 'overtime' }, { winner: 'home' }, { phase: 'final' }, { phase: 'kick' }, { overtime: { first: 'away', possessions: -1 } },
        { overtime: { first: 'both', possessions: 0 } }, { openingTeam: 'neither' }, { kick: { kind: 'xp', team: 'home', distance: 25, spot: 95, ticks: 0, lockedAt: null, good: null } },
    ];
    for (const change of bad)
        expect(decodeSave(JSON.stringify({ version: 4, state: { ...state, ...change } })), JSON.stringify(change)).toBeNull();
    const kicking = nextDown(touchdown(lineUp('home', 100)));
    for (const change of [{ kick: { ...kicking.kick!, ticks: 9999 } }, { kick: { ...kicking.kick!, lockedAt: 5 } }, { kick: { ...kicking.kick!, good: true } }, { kick: { ...kicking.kick!, team: 'away' } }, { kick: { ...kicking.kick!, kind: 'punt' } }, { kick: null }])
        expect(decodeSave(JSON.stringify({ version: 4, state: { ...kicking, ...change } })), JSON.stringify(change)).toBeNull();
    const ot = lineUp('away', 82, { game: { mode: 'overtime', quarter: 5, clock: 0, overtime: { first: 'away', possessions: 0 } } });
    expect(decodeSave(JSON.stringify({ version: 4, state: { ...ot, clock: 5 } }))).toBeNull();
    expect(decodeSave(JSON.stringify({ version: 4, state: { ...ot, quarter: 3 } }))).toBeNull();
});
it('reloading mid-kick, after a kick, in overtime or at game over repeats nothing', () => {
    const kicking = nextDown(touchdown(lineUp('home', 100)));
    const restored = decodeSave(encodeSave(kicking))!;
    expect(restored).toEqual(kicking);
    const kicked = kickAtTick(restored, CENTRE);
    expect(kicked.score.home).toBe(7);
    for (let reload = 0; reload < 3; reload++) {
        const again = decodeSave(encodeSave(kicked))!;
        expect(again).toEqual(kicked);
        expect(kickBall(again, 'home')).toBe(again);
        expect(nextDown(again).score).toEqual({ home: 7, away: 0 });
    }
    const over = stepDownToFinal();
    const done = nextDown(over);
    expect(done.phase).toBe('final');
    for (let reload = 0; reload < 3; reload++) {
        const again = decodeSave(encodeSave(done))!;
        expect(again).toEqual(done);
        expect(nextDown(again)).toBe(again);
        expect(again.winner).toBe('home');
    }
});

it('saves keep the between-play allowance, and a version-4 save (which had none) restores with the clock waiting for the snap', () => {
    const dead = tackled(createDown(), 4);
    expect(dead.gap).toBe(BETWEEN_PLAY_TICKS);
    expect(decodeSave(encodeSave(dead))?.gap).toBe(BETWEEN_PLAY_TICKS);
    const partly = stepDown(stepDown(dead, { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } }), { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } });
    expect(decodeSave(encodeSave(partly))).toEqual(partly);
    const { gap: _gap, ...v4 } = dead;
    expect(decodeSave(JSON.stringify({ version: 4, state: v4 }))?.gap).toBe(0);
    expect(decodeSave(JSON.stringify({ version: 5, state: { ...dead, gap: BETWEEN_PLAY_TICKS + 1 } }))).toBeNull();
});
