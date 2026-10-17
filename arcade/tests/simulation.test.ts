import { describe, expect, it } from "vitest";
import { createMatch, step, STEP_SECONDS, FIELD, type Inputs } from "../core/simulation";
import { advance, createClock } from "../core/clock";

const idle: Inputs = { home: { x: 0, y: 0 }, away: { x: 0, y: 0 } };
const run: Inputs = { home: { x: 1, y: 0 }, away: { x: -1, y: 0 } };

describe("movement drill", () => {
  it("moves both humans in the same tick without mutating the previous snapshot", () => {
    const before = createMatch();
    const after = step(before, run);
    expect(after.players[0]!.x).toBeGreaterThan(before.players[0]!.x);
    expect(after.players[5]!.x).toBeLessThan(before.players[5]!.x);
    expect(before.tick).toBe(0);
    expect(after.tick).toBe(1);
    expect(after.players).toHaveLength(10);
    expect(new Set(after.players.map(p => p.id)).size).toBe(10);
  });
  it("normalizes diagonals to the same speed as cardinal movement", () => {
    const before = createMatch();
    const a = step(before, run).players[0]!;
    const b = step(before, { ...idle, home: { x: 1, y: 1 } }).players[0]!;
    const origin = before.players[0]!;
    expect(Math.hypot(b.x-origin.x, b.y-origin.y)).toBeCloseTo(a.x-origin.x, 10);
    expect(a.x-origin.x).toBeCloseTo(7 * STEP_SECONDS, 10);
  });
  it.each([{x:1,y:1},{x:-1,y:-1}])("keeps every player inside the field with input %o", direction => {
    let state = createMatch();
    for(let i=0;i<2400;i++) state = step(state, {home:direction,away:direction});
    for(const p of state.players) {
      expect(p.x).toBeGreaterThanOrEqual(FIELD.radius);
      expect(p.x).toBeLessThanOrEqual(FIELD.length-FIELD.radius);
      expect(p.y).toBeGreaterThanOrEqual(FIELD.radius);
      expect(p.y).toBeLessThanOrEqual(FIELD.width-FIELD.radius);
    }
  });
  it("pursues the carrier with AI defenders and moves support teammates", () => {
    const before=createMatch();
    let state=before;
    for(let i=0;i<60;i++) state=step(state,idle);
    const carrier=before.players[0]!;
    const distance=(p:typeof carrier)=>Math.hypot(p.x-carrier.x,p.y-carrier.y);
    expect(distance(state.players[6]!)).toBeLessThan(distance(before.players[6]!));
    expect(state.players[1]!.x).toBeGreaterThan(before.players[1]!.x);
    expect(state.players[0]).toEqual(carrier);
    expect(state.players[5]).toEqual(before.players[5]);
  });
  it("replays exactly and restarts without retaining moved state", () => {
    let a=createMatch(), b=createMatch();
    for(let i=0;i<180;i++){a=step(a,run);b=step(b,run);}
    expect(a).toEqual(b);
    const reset=createMatch();
    expect(reset.tick).toBe(0);
    expect(reset.players[0]!.x).toBe(38);
    expect(reset.players[5]!.x).toBe(72);
    expect(reset.possession).toEqual({team:"home",carrier:"home-1"});
  });
  it("rejects non-finite input rather than corrupting coordinates", () => {
    expect(()=>step(createMatch(),{...idle,home:{x:NaN,y:0}})).toThrow();
  });
});

describe("fixed-step clock", () => {
  it("produces the same snapshot at 30, 60 and 144 display frames per second", () => {
    const replay=(fps:number)=>{
      let clock=createClock();
      for(let i=0;i<fps*3;i++) clock=advance(clock,1/fps,run);
      return clock.match;
    };
    expect(replay(30)).toEqual(replay(60));
    expect(replay(144)).toEqual(replay(60));
    expect(replay(60).tick).toBe(180);
  });
  it("does not move when paused or accumulate a catch-up burst", () => {
    const before=createClock();
    const stopped=advance({...before,paused:true},100,run);
    expect(stopped.match).toEqual(before.match);
    expect(stopped.accumulator).toBe(0);
    const resumed=advance({...stopped,paused:false},STEP_SECONDS,run);
    expect(resumed.match.tick).toBe(1);
  });
  it("caps a suspended frame and rejects invalid elapsed time", () => {
    expect(advance(createClock(),30,idle).match.tick).toBe(6);
    expect(()=>advance(createClock(),NaN,idle)).toThrow();
    expect(()=>advance(createClock(),-1,idle)).toThrow();
  });
});
