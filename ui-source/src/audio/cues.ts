/**
 * The moments.
 *
 * A soundtrack tells you where you are. These tell you what just happened,
 * and they are the half that has to be right — a cue that fires late, fires
 * twice, or fires for something you did on purpose is worse than silence.
 *
 * Three rules hold throughout:
 *
 *  - **Short.** Nothing here runs past a second and a half except the two
 *    fanfares, which are the two moments a season turns on.
 *  - **Distinguishable in the dark.** Each cue has its own shape — rising,
 *    falling, struck, swelling — so they can be told apart without being
 *    looked at.
 *  - **Never for something the player just clicked.** A button that makes a
 *    noise every time is a button people turn off. These fire for things that
 *    happen *to* you: the clock reaching your pick, an offer arriving, a
 *    result landing.
 */
import { audio } from "./engine.ts";
import { bass, crowd, horn, hz, noise, pluck } from "./voices.ts";

export type Cue =
  | "onTheClock"
  | "pickMade"
  | "touchdown"
  | "fieldGoal"
  | "turnover"
  | "injury"
  | "tradeOffer"
  | "signed"
  | "gameWon"
  | "gameLost"
  | "champion";

/**
 * Play one.
 *
 * Silent and free when sound is off — there is no context to schedule
 * against, so this returns before touching anything.
 */
export function cue(name: Cue): void {
  const bus = audio.sfx;
  if (!bus) return;
  const t = audio.now() + 0.02;
  CUES[name](bus, t);
}

type Player = (dest: AudioNode, t: number) => void;

/** A major triad rising from a root, the standard fanfare shape. */
function arpUp(dest: AudioNode, t: number, root: number, step: number, gain: number): void {
  for (const [i, semi] of [0, 4, 7, 12].entries()) {
    horn(dest, { when: t + i * step, freq: hz(root + semi), dur: step * 2.4, gain });
  }
}

const CUES: Record<Cue, Player> = {
  /**
   * You're on the clock.
   *
   * The one cue that has to cut through whatever else is happening, because
   * it is the only one with a deadline attached. Two rising horn calls with a
   * gap between them — the shape of a PA announcement, not of a notification.
   */
  onTheClock: (dest, t) => {
    for (const [i, semi] of [0, 7].entries()) {
      horn(dest, { when: t + i * 0.26, freq: hz(62 + semi), dur: 0.44, gain: 0.42 });
      horn(dest, { when: t + i * 0.26, freq: hz(74 + semi), dur: 0.44, gain: 0.22 });
    }
    noise(dest, { when: t, dur: 0.1, gain: 0.06, center: 3000, q: 2 });
    crowd(dest, { when: t + 0.1, dur: 1.6, gain: 0.15, intensity: 0.5 });
  },

  /** A pick is in. A struck, settled sound — something decided. */
  pickMade: (dest, t) => {
    bass(dest, { when: t, freq: hz(38), dur: 0.5, gain: 0.24 });
    pluck(dest, { when: t, freq: hz(62), dur: 0.4, gain: 0.2 });
    pluck(dest, { when: t + 0.07, freq: hz(69), dur: 0.5, gain: 0.16 });
    noise(dest, { when: t, dur: 0.16, gain: 0.07, center: 5200, q: 1.2 });
  },

  /** Touchdown. The full thing: horns, drum, and a stadium coming up. */
  touchdown: (dest, t) => {
    arpUp(dest, t, 55, 0.1, 0.26);
    bass(dest, { when: t, freq: hz(31), dur: 0.7, gain: 0.34 });
    bass(dest, { when: t + 0.4, freq: hz(31), dur: 0.6, gain: 0.24 });
    crowd(dest, { when: t + 0.05, dur: 2.6, gain: 0.26, intensity: 1 });
  },

  /** Three points. The same idea, shorter and without the last step up. */
  fieldGoal: (dest, t) => {
    for (const [i, semi] of [0, 7].entries()) {
      horn(dest, { when: t + i * 0.12, freq: hz(57 + semi), dur: 0.5, gain: 0.2 });
    }
    crowd(dest, { when: t + 0.05, dur: 1.4, gain: 0.14, intensity: 0.55 });
  },

  /** A takeaway. Struck hard and falling — a thing that went wrong somewhere. */
  turnover: (dest, t) => {
    bass(dest, { when: t, freq: hz(36), dur: 0.45, gain: 0.24 });
    noise(dest, { when: t, dur: 0.3, gain: 0.1, center: 1600, q: 0.8 });
    for (const [i, semi] of [7, 3, 0].entries()) {
      pluck(dest, { when: t + i * 0.06, freq: hz(50 + semi), dur: 0.35, gain: 0.13 });
    }
    crowd(dest, { when: t + 0.08, dur: 1.5, gain: 0.12, intensity: 0.6 });
  },

  /**
   * Someone is hurt.
   *
   * Deliberately not dramatic. A low, dull, closed sound — the stadium going
   * quiet rather than a sting telling you to feel something.
   */
  injury: (dest, t) => {
    bass(dest, { when: t, freq: hz(29), dur: 0.9, gain: 0.26 });
    pluck(dest, { when: t + 0.02, freq: hz(46), dur: 0.8, gain: 0.1 });
    pluck(dest, { when: t + 0.02, freq: hz(47), dur: 0.8, gain: 0.08 });
    noise(dest, { when: t, dur: 0.5, gain: 0.04, center: 420, q: 0.7 });
  },

  /** An offer has arrived. A question, so it ends up rather than down. */
  tradeOffer: (dest, t) => {
    pluck(dest, { when: t, freq: hz(69), dur: 0.3, gain: 0.18 });
    pluck(dest, { when: t + 0.11, freq: hz(76), dur: 0.45, gain: 0.16 });
  },

  /** A signature. Two notes, resolved, done. */
  signed: (dest, t) => {
    pluck(dest, { when: t, freq: hz(64), dur: 0.26, gain: 0.17 });
    pluck(dest, { when: t + 0.1, freq: hz(71), dur: 0.42, gain: 0.15 });
    noise(dest, { when: t + 0.01, dur: 0.1, gain: 0.04, center: 6400, q: 1.5 });
  },

  /** You won. Brief — there are seventeen of these in a season. */
  gameWon: (dest, t) => {
    arpUp(dest, t, 57, 0.09, 0.31);
    bass(dest, { when: t, freq: hz(33), dur: 0.6, gain: 0.26 });
    crowd(dest, { when: t, dur: 2, gain: 0.24, intensity: 0.85 });
  },

  /** You lost. The same interval, inverted, and no crowd. */
  gameLost: (dest, t) => {
    for (const [i, semi] of [7, 3, 0].entries()) {
      horn(dest, { when: t + i * 0.13, freq: hz(52 + semi), dur: 0.5, gain: 0.15 });
    }
  },

  /**
   * The Super Bowl.
   *
   * The longest thing in here by a distance, because it happens once and a
   * franchise mode that doesn't mark it isn't much of one.
   */
  champion: (dest, t) => {
    arpUp(dest, t, 57, 0.14, 0.28);
    arpUp(dest, t + 0.62, 64, 0.14, 0.24);
    for (const [i, semi] of [0, 4, 7, 12, 16].entries()) {
      horn(dest, { when: t + 1.25, freq: hz(57 + semi), dur: 2.2, gain: 0.2 - i * 0.02 });
    }
    bass(dest, { when: t, freq: hz(33), dur: 1, gain: 0.34 });
    bass(dest, { when: t + 0.62, freq: hz(40), dur: 1, gain: 0.3 });
    bass(dest, { when: t + 1.25, freq: hz(33), dur: 2.2, gain: 0.34 });
    crowd(dest, { when: t, dur: 4.2, gain: 0.3, intensity: 1 });
  },
};
