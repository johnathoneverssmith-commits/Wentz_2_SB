import { expect, it } from 'vitest';
import { encodeSave, decodeSave, isUnsupportedSave, SAVE_KEY, SUPPORTED_VERSIONS } from '../browser/save';
import { BETWEEN_PLAY_TICKS, QUARTER_TICKS, choosePlay, createDown, kickBall, lineUp, nextDown, snap, stepDown, type DownState } from '../core/down';
import { kickAtTick, CENTRE, expectOnlyClockMoved, tackled, touchdown } from './helpers';
/** A ten-player (five a side) snapshot, as every browser before Milestone 5B wrote it. */
const legacy = (state: DownState): Record<string, unknown> => {
    const { formation, ...rest } = state as unknown as Record<string, unknown>;
    const players = [1, 2, 3, 4, 5].flatMap(n => (['home', 'away'] as const).map(team => ({ id: `${team}-${n}`, team, number: n, human: n === 1, x: team === 'home' ? 38 - n : 72 + n, y: 7 + n * 6, abilities: { speed: 45 } })));
    const real = state.players.find(p => p.id === state.possession.carrier)!, team = state.possession.team;
    const carrier = `${team}-1`;
    return { ...rest, players: players.map(p => p.id === carrier ? { ...p, x: real.x, y: real.y } : p), defender: state.offense === 'home' ? 'away-1' : 'home-1', possession: { team, carrier } };
};
it('round trips an arcade snapshot, rejects corrupt saves and never uses a franchise key', () => {
    const state = snap(createDown());
    expect(decodeSave(encodeSave(state))).toEqual(state);
    expect(SAVE_KEY).toBe('wentz.arcade.down.v1');
    for (const bad of ['bad', '{}', JSON.stringify({ ...state, players: [] }), encodeSave({ ...state, line: NaN })])
        expect(decodeSave(bad)).toBeNull();
});
it('migrates v1 airborne and completed saves without losing prior completions', () => {
    for (const current of [createDown(), snap(createDown())]) {
        const { terminalCount, contestUntil, ...old } = legacy(current);
        const later = { ...old, playNumber: 4 };
        const migrated = decodeSave(JSON.stringify({ version: 1, state: later }))!;
        expect(migrated).toMatchObject({ phase: 'pre-snap', playNumber: 4, terminalCount: 3 });
        expect(migrated.players).toHaveLength(22);
    }
    const { terminalCount, contestUntil, ...old } = legacy(snap(createDown()));
    const live = { ...old, playNumber: 4 };
    const dead = { ...live, phase: 'dead', result: { playNumber: 4, reason: 'tackle', yards: 2.5, turnover: false, touchdown: false } };
    expect(decodeSave(JSON.stringify({ version: 1, state: dead }))).toMatchObject({ playNumber: 4, terminalCount: 4, phase: 'dead' });
});

const MID = 26.66666666665;
const scoredHome = () => {
    let s = snap(lineUp('home', 100, { score: { home: 7, away: 3 }, down: 3 }));
    s = { ...s, players: s.players.map(p => p.id === s.possession.carrier ? { ...p, x: 109.95, y: MID } : p.team !== 'home' ? { ...p, x: 30, y: 5 } : p) };
    for (let i = 0; i < 30 && s.phase === 'live'; i++) s = stepDown(s, { home: { x: 1, y: 0 }, away: { x: 0, y: 0 } });
    return s;
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
    expect(JSON.parse(encodeSave(dead)).version).toBe(6);
    expect(decodeSave(encodeSave(dead))).toEqual(dead);
    const live = snap(lineUp('away', 70, { down: 3, score: { home: 1, away: 2 } }));
    expect(decodeSave(encodeSave(live))).toEqual(live);
});
it('migrates a version-2 completed touchdown by scoring it exactly once, and starts down and marker fresh', () => {
    const dead = scoredHome();
    const old = decodeSave(asVersion2({ ...legacy(dead), score: { home: 0, away: 0 } }))!;
    expect(old.score).toEqual({ home: 6, away: 0 });
    expect(old).toMatchObject({ down: 1, firstDownLine: 110, phase: 'dead', result: { touchdown: true, firstDown: false, turnoverOnDowns: false } });
    const again = decodeSave(encodeSave(old))!;
    expect(again).toEqual(old);
    expect(nextDown(again).score).toEqual({ home: 6, away: 0 });
});
it('migrates a version-2 safety and a plain live down without inventing points', () => {
    let s = snap(lineUp('home', 14));
    s = { ...s, players: s.players.map(p => p.id === s.possession.carrier ? { ...p, x: 10.05, y: MID } : p.team !== 'home' ? { ...p, x: 100, y: 5 } : p) };
    expect(s.possession.carrier).toBe('home-RB');
    let safety = s;
    for (let i = 0; i < 40 && safety.phase === 'live'; i++) safety = stepDown(safety, { home: { x: -1, y: 0 }, away: { x: 0, y: 0 } });
    expect(decodeSave(asVersion2({ ...legacy(safety), score: { home: 0, away: 0 } }))!.score).toEqual({ home: 0, away: 2 });
    const live = snap(createDown());
    expect(decodeSave(asVersion2(legacy(live)))).toMatchObject({ score: { home: 0, away: 0 }, down: 1, firstDownLine: 48, phase: 'pre-snap' });
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
    const old = decodeSave(asVersion3(legacy(snap(lineUp('home', 60, { down: 3, score: { home: 7, away: 3 } })))))!;
    expect(old).toMatchObject({ quarter: 1, clock: QUARTER_TICKS, expired: false, mode: 'regulation', openingTeam: 'home', winner: null, kick: null, down: 3, score: { home: 7, away: 3 }, phase: 'pre-snap' });
    expect(old.overtime).toEqual({ first: 'away', possessions: 0 });
    expect(decodeSave(encodeSave(old))).toEqual(old);
    // A completed touchdown in an old save still gets its extra point, exactly once.
    const dead = touchdown(lineUp('home', 100));
    const migrated = decodeSave(asVersion3(legacy(dead)))!;
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
        expect(decodeSave(JSON.stringify({ version: 6, state: { ...state, ...change } })), JSON.stringify(change)).toBeNull();
    const kicking = nextDown(touchdown(lineUp('home', 100)));
    for (const change of [{ kick: { ...kicking.kick!, ticks: 9999 } }, { kick: { ...kicking.kick!, lockedAt: 5 } }, { kick: { ...kicking.kick!, good: true } }, { kick: { ...kicking.kick!, team: 'away' } }, { kick: { ...kicking.kick!, kind: 'punt' } }, { kick: null }])
        expect(decodeSave(JSON.stringify({ version: 6, state: { ...kicking, ...change } })), JSON.stringify(change)).toBeNull();
    const ot = lineUp('away', 82, { game: { mode: 'overtime', quarter: 5, clock: 0, overtime: { first: 'away', possessions: 0 } } });
    expect(decodeSave(JSON.stringify({ version: 6, state: { ...ot, clock: 5 } }))).toBeNull();
    expect(decodeSave(JSON.stringify({ version: 6, state: { ...ot, quarter: 3 } }))).toBeNull();
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

it('saves keep the between-play allowance, and a version-3 save (the last deployed format) migrates with the clock waiting for the snap', () => {
    const dead = tackled(createDown(), 4);
    expect(dead.gap).toBe(BETWEEN_PLAY_TICKS);
    expect(decodeSave(encodeSave(dead))?.gap).toBe(BETWEEN_PLAY_TICKS);
    const idle = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
    const partly = stepDown(stepDown(dead, idle), idle);
    expect(decodeSave(encodeSave(partly))).toEqual(partly);
    expect(decodeSave(JSON.stringify({ version: 6, state: { ...dead, gap: BETWEEN_PLAY_TICKS + 1 } }))).toBeNull();
    const { gap: _g, quarter: _q, clock: _c, expired: _e, mode: _m, openingTeam: _o, overtime: _ot, winner: _w, kick: _k, ...v3 } = legacy(dead) as Record<string, unknown>;
    expect(decodeSave(JSON.stringify({ version: 3, state: v3 }))).toMatchObject({ quarter: 1, clock: QUARTER_TICKS, gap: 0, mode: 'regulation' });
});

it('compatibility boundary: version 4 (unreleased, with differing clock units) and unknown versions are rejected, never converted', () => {
    const dead = tackled(createDown(), 4);
    for (const clock of [1800, QUARTER_TICKS, 10]) {
        const text = JSON.stringify({ version: 4, state: { ...dead, clock } });
        expect(decodeSave(text), `v4 clock ${clock}`).toBeNull();
        expect(isUnsupportedSave(text)).toBe(true);
    }
    for (const version of [0, 7, 99, '6', null]) expect(decodeSave(JSON.stringify({ version, state: dead })), String(version)).toBeNull();
    expect(isUnsupportedSave(JSON.stringify({ version: 7, state: dead }))).toBe(true);
    for (const text of [encodeSave(dead), JSON.stringify({ version: 3, state: {} }), 'not json', null, '{"version":6']) expect(isUnsupportedSave(text), String(text)).toBe(false);
    expect(SUPPORTED_VERSIONS).toEqual([1, 2, 3, 5, 6]);
});

it('version 5 (ten players) migrates into eleven a side: the game carries over, a live play restarts from its snap, a finished down stays finished', () => {
    const live = lineUp('away', 70, { down: 3, score: { home: 9, away: 3 }, game: { quarter: 3, clock: 4321, expired: false, gap: 100 } });
    const old = decodeSave(JSON.stringify({ version: 5, state: legacy({ ...snap(live) }) }))!;
    expect(old).toMatchObject({ offense: 'away', line: 70, down: 3, score: { home: 9, away: 3 }, quarter: 3, clock: 4321, gap: 100, phase: 'pre-snap', result: null });
    expect(old.players).toHaveLength(22);
    expect(old.players.filter(p => p.team === 'home')).toHaveLength(11);
    expect(decodeSave(encodeSave(old))).toEqual(old);
    const dead = tackled(createDown(), 4);
    const kept = decodeSave(JSON.stringify({ version: 5, state: legacy(dead) }))!;
    expect(kept).toMatchObject({ phase: 'dead', result: dead.result, score: dead.score, terminalCount: dead.terminalCount });
    expect(nextDown(kept)).toMatchObject({ offense: 'home', down: 2, line: 42 });
});
it('rejects eleven-a-side saves whose players are not a real roster', () => {
    const state = snap(createDown());
    const bad: Record<string, unknown>[] = [
        { players: state.players.slice(1) }, { players: [...state.players.slice(1), state.players[1]] },
        { players: state.players.map((p, i) => i === 0 ? { ...p, id: 'home-QBX' } : p) },
        { players: state.players.map((p, i) => i === 0 ? { ...p, x: Number.NaN } : p) },
        { players: state.players.map((p, i) => i === 0 ? { ...p, x: 500 } : p) },
        { players: state.players.map((p, i) => i === 0 ? { ...p, abilities: { ...p.abilities, speed: 120 } } : p) },
        { players: state.players.map((p, i) => i === 0 ? { ...p, behavior: 'dance' } : p) },
        { players: state.players.map((p, i) => i === 0 ? { ...p, lock: { with: 'home-NOBODY', since: 0 } } : p) },
        { players: state.players.map((p, i) => i === 0 ? { ...p, position: 'QB' } : p) },
        { formation: { offense: 'wishbone', defense: 'nickel' } }, { formation: null },
        { defender: 'home-QB' }, { possession: { team: 'home', carrier: 'away-RB' } },
    ];
    for (const change of bad) expect(decodeSave(JSON.stringify({ version: 6, state: { ...state, ...change } })), JSON.stringify(change).slice(0, 80)).toBeNull();
});
it('a live play with assignments, locks and the ball in the air saves and reloads exactly', () => {
    let s = snap(choosePlay(createDown(), 'go'));
    const idle = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
    for (let i = 0; i < 70; i++) s = stepDown(s, idle);
    expect(s.players.some(p => p.lock)).toBe(true);
    expect(decodeSave(encodeSave(s))).toEqual(s);
});
