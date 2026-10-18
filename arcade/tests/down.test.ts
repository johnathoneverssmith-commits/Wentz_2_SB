import { encodeSave, decodeSave } from "../browser/save";
import { expect, it } from "vitest";
import { createDown, snap, choosePlay, throwPass, switchDefender, nextDown, stepDown, type DownState } from "../core/down";
import type { Inputs, PlayerId } from "../core/simulation";
const idle: Inputs = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
const ticks = (state: DownState, n: number, inputs = idle) => { for (let i = 0; i < n; i++)
    state = stepDown(state, inputs); return state; };
const place = (state: DownState, id: PlayerId, x: number, y: number): DownState => ({ ...state, players: state.players.map(p => p.id === id ? { ...p, x, y } : p) });
const isolated = (state: DownState): DownState => ({ ...state, players: state.players.map(p => p.team !== state.possession.team ? { ...p, x: 105, y: 48 } : p) });
it("waits for snap, rejects live play changes and cannot snap twice", () => {
    const pre = createDown();
    expect(stepDown(pre, idle)).toBe(pre);
    expect(throwPass(pre, 1)).toBe(pre);
    const live = snap(choosePlay(pre, "slants"));
    expect(live.phase).toBe("live");
    expect(snap(live)).toBe(live);
    expect(choosePlay(live, "rush")).toBe(live);
});
it("hands off on a rush and transfers human movement to the running back", () => {
    const state = snap(createDown());
    expect(state.possession.carrier).toBe("home-2");
    const after = stepDown(state, { ...idle, home: { x: 1, y: 0 } });
    expect(after.players.find(p => p.id === "home-2")!.x).toBeGreaterThan(38);
    expect(after.players.find(p => p.id === "home-1")!.human).toBe(false);
});
it.each(["slants", "go"] as const)("has real flight then a catch on %s", play => {
    const state = isolated(snap(choosePlay(createDown(), play)));
    const air = throwPass(state, 1);
    expect(air.ball.kind).toBe("flight");
    expect(throwPass(air, 2)).toBe(air);
    const caught = ticks(air, 40);
    expect(caught.phase).toBe("live");
    expect(caught.ball.kind).toBe("held");
    expect(caught.possession.carrier).toBe("home-3");
    expect(caught.players.find(p => p.id === "home-3")!.human).toBe(true);
});
it("an unreachable target is incomplete, with zero yards and the original spot", () => {
    let state = throwPass(isolated(snap(choosePlay(createDown(), "go"))), 2);
    state = place(state, "home-4", 15, 48);
    const dead = ticks(state, 40);
    expect(dead.result).toMatchObject({ reason: "incomplete", yards: 0, turnover: false, touchdown: false });
    expect(nextDown(dead).line).toBe(38);
});
it("a defender at the arrival point intercepts and the next down changes sides", () => {
    let air = throwPass(isolated(snap(choosePlay(createDown(), "go"))), 1);
    if (air.ball.kind !== "flight")
        throw Error("flight required");
    air = place(air, "away-1", air.ball.to.x, air.ball.to.y);
    const dead = ticks(air, 40);
    expect(dead.result?.reason).toBe("interception");
    expect(dead.result?.turnover).toBe(true);
    expect(dead.possession).toEqual({ team: "away", carrier: "away-1" });
    const next = nextDown(dead);
    expect(next.phase).toBe("pre-snap");
    expect(next.possession.team).toBe("away");
    const moved = stepDown(snap(choosePlay(next, "rush")), { ...idle, away: { x: -1, y: 0 } });
    expect(moved.players.find(p => p.id === "away-2")!.x).toBeLessThan(next.line);
});
it("switches through all five defenders and only the selected one follows human input", () => {
    const state = snap(createDown()), switched = switchDefender(state);
    expect(switched.defender).toBe("away-2");
    const moved = stepDown(switched, { ...idle, away: { x: 1, y: 0 } });
    expect(moved.players.find(p => p.id === "away-2")!.x).toBeGreaterThan(switched.players.find(p => p.id === "away-2")!.x);
    let round = state;
    for (let i = 0; i < 5; i++)
        round = switchDefender(round);
    expect(round.defender).toBe(state.defender);
});
it("contact tackles exactly once and terminal snapshots cannot simulate again", () => {
    const state = place(snap(createDown()), "away-1", 38, 26.66666666665);
    const dead = stepDown(state, idle);
    expect(dead.result).toMatchObject({ reason: "tackle", yards: 0 });
    expect(ticks(dead, 100)).toBe(dead);
    expect(snap(dead)).toBe(dead);
    expect(throwPass(dead, 1)).toBe(dead);
    const next = nextDown(dead);
    expect(next.playNumber).toBe(2);
    expect(next.result).toBeNull();
    expect(nextDown(next)).toBe(next);
});
it.each([{ x: 109.99, y: 26, reason: "touchdown", td: true }, { x: 50, y: 0.91, reason: "out-of-bounds", td: false }, { x: 10.01, y: 26, reason: "safety", td: false }])("ends on $reason", ({ x, y, reason, td }) => {
    let state = isolated(snap(createDown()));
    state = place(state, "home-2", x, y);
    const dead = stepDown(state, { ...idle, home: { x: reason === "safety" ? -1 : 1, y: reason === "out-of-bounds" ? -1 : 0 } });
    expect(dead.result?.reason).toBe(reason);
    expect(dead.result?.touchdown).toBe(td);
    expect(ticks(dead, 3)).toBe(dead);
});
it("times out an abandoned play and deterministic replay has identical results", () => {
    const a = ticks(snap(createDown()), 1000), b = ticks(snap(createDown()), 1000);
    expect(a).toEqual(b);
    expect(a.phase).toBe("dead");
    const slow = { ...isolated(snap(createDown())), liveTicks: 899 };
    expect(stepDown(slow, idle).result?.reason).toBe("timeout");
});
it('preserves the snap source and cannot throw a second forward pass after a catch', () => {
    const before = choosePlay(createDown(), 'go'), live = snap(before);
    expect(before.phase).toBe('pre-snap');
    expect(before.players[0]!.human).toBe(true);
    const caught = ticks(throwPass(isolated(live), 2), 40);
    expect(caught.possession.carrier).toBe('home-4');
    expect(throwPass(caught, 1)).toBe(caught);
});
it('checks the lower end zone for an away offense and resets after a score', () => {
    const home = place(snap(createDown()), 'away-1', 38, 26.66666666665);
    const dead = stepDown(home, idle);
    const away = { ...nextDown(dead), offense: 'away' as const, possession: { team: 'away' as const, carrier: 'away-1' as const }, defender: 'home-1' as const };
    let live = isolated(snap(choosePlay(away, 'rush')));
    live = place(live, 'away-2', 10.01, 26);
    const scored = stepDown(live, { ...idle, away: { x: -1, y: 0 } });
    expect(scored.result?.reason).toBe('touchdown');
    expect(scored.result?.touchdown).toBe(true);
    expect(nextDown(scored).line).toBe(82);
    expect(nextDown(scored).offense).toBe('away');
});
it('a pass led beyond the field is actually incomplete in an unmodified route', () => {
    let live = isolated(snap(choosePlay(createDown(), 'go')));
    live = { ...live, line: 108, players: live.players.map(p => p.id === 'home-3' ? { ...p, x: 119.1 } : p) };
    const dead = ticks(throwPass(live, 1), 40);
    expect(dead.result?.reason).toBe('incomplete');
});
it('AI decisions and contested catches do not depend on player array order', () => {
    const a = throwPass(isolated(snap(choosePlay(createDown(), 'go'))), 1);
    const b = { ...a, players: [...a.players].reverse() };
    const first = ticks(a, 40), second = ticks(b, 40);
    expect(first.possession).toEqual(second.possession);
    expect(first.result).toEqual(second.result);
    expect([...first.players].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...second.players].sort((a, b) => a.id.localeCompare(b.id)));
});
it('a timeout during flight remains a reloadable completed down', () => {
    const live = { ...snap(choosePlay(createDown(), 'go')), liveTicks: 899 };
    const dead = stepDown(throwPass(live, 1), idle);
    expect(dead.phase).toBe('dead');
    expect(dead.ball.kind).toBe('held');
    expect(decodeSave(encodeSave(dead))).toEqual(dead);
});
