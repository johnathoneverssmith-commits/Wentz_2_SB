/**
 * The score: seven moods, generated a bar at a time.
 *
 * There is no recording here and no loop being replayed. Each bar is composed
 * when it is needed, from a mood's key, tempo, chord progression and a couple
 * of pattern rules — so the music moves with the game instead of sitting
 * underneath it, and two drafts never sound quite the same.
 *
 * ## How it stays in time
 *
 * `setInterval` is not accurate enough to place notes on. So this uses the
 * standard Web Audio arrangement: a timer that wakes four times a second and
 * schedules every note that falls in the next quarter of a second, against
 * the audio clock. The browser's audio thread then plays them at exactly the
 * right moment regardless of what the main thread is doing. A dropped frame
 * during a week simulation cannot make the music stutter.
 *
 * ## How it stays in key
 *
 * Every mood is a root note, a scale, and a progression in scale degrees.
 * Melodic choices are random but constrained to the chord underneath, which
 * is what keeps generated music from wandering — the notes are picked, the
 * harmony is not.
 *
 * Randomness is seeded per bar from the bar number, so a mood is
 * reproducible and a long session doesn't drift into noise.
 */
import { bass, horn, hz, noise, pad, pluck } from "./voices.ts";

export type MoodName =
  | "lobby"
  | "frontOffice"
  | "draft"
  | "freeAgency"
  | "gameday"
  | "playoffs"
  | "champion";

interface Mood {
  /** MIDI note of the tonic. */
  root: number;
  /** Semitone offsets, one octave. */
  scale: number[];
  bpm: number;
  /** Chord roots as scale degrees, one per bar. */
  progression: number[];
  /** How much melody there is, 0–1. */
  density: number;
  /** Pad brightness in Hz. */
  cutoff: number;
  /** Brass on the downbeat. */
  brass?: boolean;
  /** A hat on the offbeat. */
  pulse?: boolean;
  /** A quiet tick every beat — the draft clock. */
  tick?: boolean;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];

/**
 * The moods, and what each is for.
 *
 * The through-line is that the offseason is quiet and reflective and the
 * season is not. A GM reading a cap table should be able to forget the music
 * is on; a GM on the clock should not.
 */
const MOODS: Record<MoodName, Mood> = {
  // League setup: nothing has happened yet. Wide, slow, unhurried.
  lobby: { root: 45, scale: MINOR, bpm: 62, progression: [0, 5, 3, 4], density: 0.3, cutoff: 780 },

  // Roster, cap, trades, coaching. Deliberately the least interesting music
  // in the game — it is background to spreadsheets.
  frontOffice: {
    root: 43,
    scale: DORIAN,
    bpm: 74,
    progression: [0, 3, 4, 3],
    density: 0.34,
    cutoff: 820,
  },

  // The draft. A clock you can hear, and a figure that keeps climbing without
  // ever quite arriving.
  draft: {
    root: 40,
    scale: MINOR,
    bpm: 94,
    progression: [0, 0, 5, 4],
    density: 0.5,
    cutoff: 1100,
    tick: true,
    pulse: true,
  },

  // Free agency: a market. Busier, brighter, a little restless.
  freeAgency: {
    root: 45,
    scale: MIXOLYDIAN,
    bpm: 104,
    progression: [0, 4, 5, 3],
    density: 0.62,
    cutoff: 1500,
    pulse: true,
  },

  // Game day. Brass, drive, the only mood that sounds like a broadcast.
  gameday: {
    root: 43,
    scale: MIXOLYDIAN,
    bpm: 120,
    progression: [0, 3, 4, 4],
    density: 0.55,
    cutoff: 1700,
    brass: true,
    pulse: true,
  },

  // January. Lower, heavier, slower than the regular season — more weight per
  // note rather than more notes.
  playoffs: {
    root: 38,
    scale: MINOR,
    bpm: 88,
    progression: [0, 6, 5, 0],
    density: 0.45,
    cutoff: 1200,
    brass: true,
  },

  // You won it. The only major key in the game.
  champion: {
    root: 45,
    scale: MAJOR,
    bpm: 100,
    progression: [0, 4, 5, 4],
    density: 0.7,
    cutoff: 2200,
    brass: true,
    pulse: true,
  },
};

/** Deterministic per bar, so a mood is reproducible rather than drifting. */
function rngFor(bar: number, salt: number): () => number {
  let x = (bar * 2_654_435_761 + salt * 40_503) >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4_294_967_296;
  };
}

/** Scale degree -> MIDI, wrapping octaves so a degree above 6 goes up. */
function noteAt(mood: Mood, degree: number, octave = 0): number {
  const len = mood.scale.length;
  const wrapped = ((degree % len) + len) % len;
  const lift = Math.floor(degree / len) + octave;
  return mood.root + (mood.scale[wrapped] ?? 0) + 12 * lift;
}

/**
 * Compose and schedule one bar.
 *
 * Four beats. The chord holds underneath; the bass marks one and three; the
 * melody picks from the chord tones and the two notes either side of them.
 */
function scheduleBar(mood: Mood, bar: number, at: number, dest: AudioNode): void {
  const beat = 60 / mood.bpm;
  const barLen = beat * 4;
  const degree = mood.progression[bar % mood.progression.length] ?? 0;
  const rand = rngFor(bar, mood.root);

  // the chord: root, third, fifth of the current degree
  for (const [i, step] of [0, 2, 4].entries()) {
    pad(dest, {
      when: at,
      freq: hz(noteAt(mood, degree + step, i === 0 ? 0 : 1)),
      dur: barLen * 0.98,
      gain: 0.16,
      cutoff: mood.cutoff,
    });
  }

  bass(dest, { when: at, freq: hz(noteAt(mood, degree, -1)), dur: beat * 0.9, gain: 0.32 });
  bass(dest, {
    when: at + beat * 2,
    freq: hz(noteAt(mood, degree, -1)),
    dur: beat * 0.7,
    gain: 0.22,
  });

  if (mood.brass && bar % 2 === 0) {
    horn(dest, { when: at, freq: hz(noteAt(mood, degree, 0)), dur: beat * 1.6, gain: 0.2 });
    horn(dest, { when: at, freq: hz(noteAt(mood, degree + 4, 0)), dur: beat * 1.6, gain: 0.13 });
  }

  if (mood.pulse) {
    for (let b = 0; b < 4; b++) {
      noise(dest, {
        when: at + beat * b + beat / 2,
        dur: 0.055,
        gain: 0.035,
        center: 7200,
        q: 1.6,
      });
    }
  }

  if (mood.tick) {
    for (let b = 0; b < 4; b++) {
      noise(dest, { when: at + beat * b, dur: 0.02, gain: 0.05, center: 2400, q: 5 });
    }
  }

  // melody: eighth notes, mostly rests, always a chord tone or its neighbour
  for (let step = 0; step < 8; step++) {
    if (rand() > mood.density) continue;
    const pick = [0, 2, 4, 6, 1][Math.floor(rand() * 5)] ?? 0;
    const octave = rand() < 0.25 ? 2 : 1;
    pluck(dest, {
      when: at + (barLen / 8) * step,
      freq: hz(noteAt(mood, degree + pick, octave)),
      dur: (barLen / 8) * (rand() < 0.3 ? 1.7 : 0.9),
      gain: 0.14 + rand() * 0.07,
    });
  }
}

/**
 * Keeps one mood playing and crossfades to the next.
 *
 * Each mood gets its own gain node, so a change is a fade between two of them
 * rather than a cut — the old mood finishes the bars it already scheduled
 * while the new one comes up underneath.
 */
export class MusicDirector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: MoodName | null = null;
  private bus: GainNode | null = null;
  private voice: GainNode | null = null;
  private nextBarAt = 0;
  private bar = 0;

  /** Lookahead: schedule anything starting in the next quarter second. */
  private static readonly HORIZON = 0.25;
  private static readonly TICK_MS = 60;
  private static readonly FADE = 1.4;

  get mood(): MoodName | null {
    return this.current;
  }

  /**
   * Play `mood`, crossfading from whatever is playing.
   *
   * Calling it with the mood already playing does nothing, which matters
   * because this is driven from React state and will be called on every
   * render that touches the store.
   */
  play(mood: MoodName, bus: GainNode): void {
    if (this.current === mood && this.timer) return;
    const ctx = bus.context;
    const now = ctx.currentTime;

    if (this.voice) {
      const old = this.voice;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + MusicDirector.FADE);
      // let the tail finish, then let it go
      window.setTimeout(() => old.disconnect(), (MusicDirector.FADE + 6) * 1000);
    }

    const voice = ctx.createGain();
    voice.gain.setValueAtTime(0, now);
    voice.gain.linearRampToValueAtTime(1, now + MusicDirector.FADE);
    voice.connect(bus);

    this.voice = voice;
    this.bus = bus;
    this.current = mood;
    this.bar = 0;
    this.nextBarAt = now + 0.08;

    if (!this.timer) {
      this.timer = setInterval(() => this.pump(), MusicDirector.TICK_MS);
    }
  }

  /** Stop scheduling and fade out. Safe to call when nothing is playing. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.voice && this.bus) {
      const now = this.bus.context.currentTime;
      const old = this.voice;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + 0.6);
      window.setTimeout(() => old.disconnect(), 7000);
    }
    this.voice = null;
    this.current = null;
  }

  private pump(): void {
    const voice = this.voice;
    const name = this.current;
    if (!voice || !name) return;
    const ctx = voice.context;
    const mood = MOODS[name];
    const barLen = (60 / mood.bpm) * 4;

    // If the tab was backgrounded the clock has run on without us. Don't try
    // to catch up by scheduling a hundred bars at once — just rejoin.
    if (this.nextBarAt < ctx.currentTime - 1) this.nextBarAt = ctx.currentTime + 0.05;

    while (this.nextBarAt < ctx.currentTime + MusicDirector.HORIZON) {
      scheduleBar(mood, this.bar, this.nextBarAt, voice);
      this.bar += 1;
      this.nextBarAt += barLen;
    }
  }
}
