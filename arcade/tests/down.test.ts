import { encodeSave, decodeSave } from "../browser/save";
import { expect, it } from "vitest";
import { lineUp, createDown, snap, choosePlay, throwPass, switchDefender, nextDown, stepDown, contestPass, type DownState } from "../core/down";
import type { Inputs, PlayerId } from "../core/simulation";
import { CENTRE, MID, expectOnlyClockMoved, farAway, kickAtTick, place, quiet, seedWhere } from './helpers';
const idle: Inputs = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
const ticks = (state: DownState, n: number, inputs = idle) => {
    for (let i = 0; i < n; i++)
        state = stepDown(state, inputs);
    return state;
};
const at = (s: DownState, id: PlayerId) => s.players.find(p => p.id === id)!;
it("waits for snap, rejects live play changes and cannot snap twice", () => {
    const pre = createDown();
    expect(stepDown(pre, idle)).toBe(pre);
    expect(throwPass(pre, 1)).toBe(pre);
    const live = snap(choosePlay(pre, "slants"));
    expect(live.phase).toBe("live");
    expect(snap(live)).toBe(live);
    expect(choosePlay(live, "rush")).toBe(live);
});
it("a rush gives the ball to the running back, who is then the one the human moves", () => {
    const state = snap(createDown());
    expect(state.possession.carrier).toBe("home-RB");
    const start = at(state, "home-RB").x;
    const after = quiet(state, 30, { ...idle, home: { x: 1, y: 0 } });
    expect(at(after, "home-RB").x).toBeGreaterThan(start + 1);
    expect(at(after, "home-RB").human).toBe(true);
    expect(at(after, "home-QB").human).toBe(false);
});
it.each(["slants", "go"] as const)("has real flight then a catch on %s", play => {
    const state = farAway(snap(choosePlay(createDown(), play)));
    const air = throwPass(state, 1);
    expect(air.ball.kind).toBe("flight");
    expect(throwPass(air, 2)).toBe(air);
    const caught = quiet(air, 64);
    expect(caught.phase).toBe("live");
    expect(caught.ball.kind).toBe("held");
    expect(caught.possession.carrier).toBe("home-WR1");
    expect(at(caught, "home-WR1").human).toBe(true);
    expect(at(caught, "home-QB").human).toBe(false);
});
it("an unreachable target is incomplete, with zero yards and the original spot", () => {
    let state = throwPass(farAway(snap(choosePlay(createDown(), "go"))), 2);
    state = place(state, "home-WR2", 15, 48);
    const dead = quiet(state, 64);
    expect(dead.result).toMatchObject({ reason: "incomplete", yards: 0, turnover: false, touchdown: false });
    expect(nextDown(dead).line).toBe(38);
});
it("a defender at the arrival point intercepts and the next down changes sides", () => {
    // Whether a defender on the ball takes it is chance (core/catch.ts); this is about what an interception does, so it is staged under a seed that has one.
    const stage = (seed: number) => {
        let air = throwPass(farAway(snap(choosePlay(createDown(seed), "go"))), 1);
        if (air.ball.kind !== "flight")
            throw Error("flight required");
        air = ticks(air, 50);
        if (air.ball.kind !== "flight")
            throw Error("still in flight");
        air = place(air, "away-CB1", air.ball.to.x, air.ball.to.y);
        return ticks(air, 14);
    };
    const dead = stage(seedWhere(stage, s => s.result?.reason === "interception"));
    expect(dead.result?.reason).toBe("interception");
    expect(dead.catchKind).toBe("interception");
    expect(dead.result?.turnover).toBe(true);
    expect(dead.possession).toEqual({ team: "away", carrier: "away-CB1" });
    const next = nextDown(dead);
    expect(next.phase).toBe("pre-snap");
    expect(next.possession.team).toBe("away");
    expect(next.possession.carrier).toBe("away-QB");
    expect(next.players.filter(p => p.team === "away" && p.position !== "CB" || p.team === "away").length).toBe(11);
});
it("switching defenders walks through all eleven, nearest the ball first, and only the selected one follows human input", () => {
    const state = snap(createDown()), switched = switchDefender(state);
    expect(switched.defender).not.toBe(state.defender);
    const moved = quiet(switched, 20, { ...idle, away: { x: 1, y: 0 } }, [switched.defender]);
    expect(at(moved, switched.defender).x).toBeGreaterThan(at(switched, switched.defender).x + 0.5);
    const seen = new Set<string>();
    let round = state;
    for (let i = 0; i < 11; i++) { seen.add(round.defender); round = switchDefender(round); }
    expect(seen.size).toBe(11);
    expect(round.defender).toBe(state.defender);
    expect(round.players.filter(p => p.team === "away" && p.human)).toHaveLength(1);
});
it("contact tackles exactly once and terminal snapshots cannot simulate again", () => {
    let state = snap(createDown());
    const rb = at(state, "home-RB");
    state = place(farAway(state, ["away-MLB"]), "away-MLB", rb.x + 1.7, rb.y);
    const dead = stepDown(state, idle);
    expect(dead.result).toMatchObject({ reason: "tackle" });
    expect(dead.result!.yards).toBeCloseTo(rb.x - 38, 1);
    expectOnlyClockMoved(ticks(dead, 100), dead);
    expect(snap(dead)).toBe(dead);
    expect(throwPass(dead, 1)).toBe(dead);
    const next = nextDown(dead);
    expect(next.playNumber).toBe(2);
    expect(next.result).toBeNull();
    expect(nextDown(next)).toBe(next);
});
it.each([{ x: 109.99, y: 26, reason: "touchdown", td: true }, { x: 50, y: 0.91, reason: "out-of-bounds", td: false }, { x: 10.01, y: 26, reason: "safety", td: false }])("ends on $reason", ({ x, y, reason, td }) => {
    let state = farAway(snap(createDown()));
    state = place(state, "home-RB", x, y);
    const dead = quiet(state, 20, { ...idle, home: { x: reason === "safety" ? -1 : 1, y: reason === "out-of-bounds" ? -1 : 0 } });
    expect(dead.result?.reason).toBe(reason);
    expect(dead.result?.touchdown).toBe(td);
    expectOnlyClockMoved(ticks(dead, 3), dead);
});
it("times out an abandoned play and deterministic replay has identical results", () => {
    const a = ticks(snap(createDown()), 1000), b = ticks(snap(createDown()), 1000);
    expect(a).toEqual(b);
    expect(a.phase).toBe("dead");
    const slow = { ...farAway(snap(createDown())), liveTicks: 899 };
    expect(stepDown(slow, idle).result?.reason).toBe("timeout");
});
it('preserves the snap source and cannot throw a second forward pass after a catch', () => {
    const before = choosePlay(createDown(), 'go'), live = snap(before);
    expect(before.phase).toBe('pre-snap');
    expect(before.players.find(p => p.id === 'home-QB')!.human).toBe(true);
    const caught = quiet(throwPass(farAway(live), 2), 64);
    expect(caught.possession.carrier).toBe('home-WR2');
    expect(throwPass(caught, 1)).toBe(caught);
});
it('checks the lower end zone for an away offense, scores it once and gives the ball to the opponent', () => {
    let live = farAway(snap(choosePlay(lineUp('away', 82), 'rush')));
    live = place(live, 'away-RB', 10.01, MID);
    const scored = quiet(live, 20, { ...idle, away: { x: -1, y: 0 } });
    expect(scored.result?.reason).toBe('touchdown');
    expect(scored.result?.touchdown).toBe(true);
    expect(scored.score).toEqual({ home: 0, away: 6 });
    const kick = nextDown(scored);
    expect(kick).toMatchObject({ phase: 'kick', kick: { kind: 'xp', team: 'away' }, score: { home: 0, away: 6 } });
    const after = nextDown(kickAtTick(kick, CENTRE));
    expect(after).toMatchObject({ line: 38, offense: 'home', score: { home: 0, away: 7 } });
});
it('near either goal line a deep route ends in the end zone: the pass is catchable and scores, never thrown out of the field', () => {
    for (const [team, line, x] of [['home', 105, 110], ['away', 15, 10]] as const) {
        const live = farAway(snap(choosePlay(lineUp(team, line), 'go')));
        // Wait in the pocket until the receiver has run his route to the back of the end zone, then throw.
        const air = throwPass(quiet(live, 160), 1);
        if (air.ball.kind !== 'flight')
            throw Error('flight');
        expect(air.ball.to.x).toBeGreaterThan(0.9);
        expect(air.ball.to.x).toBeLessThan(119.1);
        const dead = quiet(air, 64);
        expect(dead.result?.reason, `${team} from the ${line}`).toBe('touchdown');
        const wr = dead.players.find(p => p.id === `${team}-WR1`)!;
        expect(team === 'home' ? wr.x >= x : wr.x <= x).toBe(true);
    }
});
it('AI decisions and contested catches do not depend on player array order', () => {
    const a = throwPass(farAway(snap(choosePlay(createDown(), 'go'))), 1);
    const b = { ...a, players: [...a.players].reverse() };
    const first = ticks(a, 64), second = ticks(b, 64);
    expect(first.possession).toEqual(second.possession);
    expect(first.result).toEqual(second.result);
    const sorted = (s: DownState) => [...s.players].sort((x, y) => x.id.localeCompare(y.id)).map(p => ({ ...p, x: +p.x.toFixed(6), y: +p.y.toFixed(6), vx: +p.vx.toFixed(6), vy: +p.vy.toFixed(6) }));
    expect(sorted(first)).toEqual(sorted(second));
});
it('a timeout during flight remains a reloadable completed down', () => {
    const live = { ...snap(choosePlay(createDown(), 'go')), liveTicks: 899 };
    const dead = stepDown(throwPass(live, 1), idle);
    expect(dead.phase).toBe('dead');
    expect(dead.ball.kind).toBe('held');
    expect(decodeSave(encodeSave(dead))).toEqual(dead);
});
it('contest: a hands press only affects the selected human defender', () => {
    const air = throwPass(farAway(snap(choosePlay(createDown(), 'go'))), 1);
    const contested = contestPass(air, 'away');
    expect(contested.contestUntil).toBeGreaterThan(air.tick);
    expect(contestPass(air, 'home')).toBe(air);
});
