/**
 * The score: seven moods of full-tilt workout rock, generated a bar at a time.
 *
 * The brief is the old Madden soundtrack: loud, fast, a little ridiculous —
 * double-kick drums, a palm-muted guitar chugging under power chords, a
 * screaming lead, a riser into the next downbeat, and (in `chants.ts`) a
 * voice shouting something absurd over the top. Nothing here is a recording or
 * a copy of one: every note is composed when it is needed, from a mood's key,
 * tempo, chord progression and a riff pattern, and played by oscillators and
 * noise.
 *
 * ## How it stays in time
 *
 * `setInterval` is not accurate enough to place notes on. So this uses the
 * standard Web Audio arrangement: a timer that wakes about sixteen times a
 * second and schedules every note that falls in the next quarter of a second,
 * against the audio clock. The browser's audio thread then plays them at
 * exactly the right moment regardless of what the main thread is doing.
 *
 * ## How it stays in key
 *
 * Every mood is a root note, a scale, and a progression in scale degrees. The
 * riff plays the chord root; the lead picks from the chord and its neighbours.
 * Randomness is seeded per bar from the bar number, so a mood is reproducible.
 */
import { crash, growl, hz, kick, lead, noise, riff, riser, snare } from "./voices.ts";
import { shout } from "./chants.ts";

export type MoodName =
  | "lobby"
  | "frontOffice"
  | "draft"
  | "freeAgency"
  | "gameday"
  | "playoffs"
  | "champion";

/** One bar is sixteen steps. A pattern marks the steps something plays on. */
type Steps = readonly number[];

interface Mood {
  /** MIDI note of the tonic (the guitar lives an octave or two below the lead). */
  root: number;
  /** Semitone offsets, one octave. */
  scale: number[];
  bpm: number;
  /** Chord roots as scale degrees, one per bar. */
  progression: number[];
  /** Kick steps. */
  kick: Steps;
  /** Snare steps. */
  snare: Steps;
  /** Hi-hat every this-many steps (2 = eighths, 1 = sixteenths). */
  hat: number;
  /** Steps the guitar chugs on (palm-muted); accents are the steps in `hits`. */
  chug: Steps;
  /** Steps the guitar rings a full power chord on. */
  hits: Steps;
  /** How much lead there is, 0–1. */
  lead: number;
  /** Overall weight: scales the drums and the guitar. */
  weight: number;
}

const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];

// the step grids the drum and guitar parts are built from
const EVERY_BEAT: Steps = [0, 4, 8, 12];
const BACKBEAT: Steps = [4, 12];
const EIGHTHS: Steps = [0, 2, 4, 6, 8, 10, 12, 14];
const DOUBLE_KICK: Steps = [0, 2, 3, 6, 8, 10, 11, 14];
const GALLOP: Steps = [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15];
const CHUG_16: Steps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

/**
 * The moods, and what each is for.
 *
 * Everything is fast — nothing here sits below 138 bpm. The desk jobs just
 * carry less lead guitar; the draft and free agency pick up the double-kick,
 * and game day and January are the full gallop.
 */
const MOODS: Record<MoodName, Mood> = {
  // League setup: the walk-out. Fast and heavy from the first bar.
  lobby: {
    root: 40,
    scale: PHRYGIAN,
    bpm: 140,
    progression: [0, 0, 1, 0],
    kick: EIGHTHS,
    snare: BACKBEAT,
    hat: 1,
    chug: CHUG_16,
    hits: [0, 8],
    lead: 0.2,
    weight: 0.9,
  },

  // Roster, cap, trades. Still the workout — the same speed as everywhere else,
  // with less lead guitar so a cap table stays readable.
  frontOffice: {
    root: 38,
    scale: MINOR,
    bpm: 142,
    progression: [0, 5, 3, 4],
    kick: EIGHTHS,
    snare: BACKBEAT,
    hat: 1,
    chug: CHUG_16,
    hits: [0, 6, 8],
    lead: 0.22,
    weight: 0.9,
  },

  // The draft: on the clock, eighth-note kicks, and a riff that keeps climbing.
  draft: {
    root: 40,
    scale: PHRYGIAN,
    bpm: 138,
    progression: [0, 0, 5, 4],
    kick: EIGHTHS,
    snare: BACKBEAT,
    hat: 1,
    chug: CHUG_16,
    hits: [0, 6, 10],
    lead: 0.32,
    weight: 0.95,
  },

  // Free agency: a bidding war. Bright, mean, and a little bit unhinged.
  freeAgency: {
    root: 43,
    scale: HARMONIC_MINOR,
    bpm: 146,
    progression: [0, 4, 5, 3],
    kick: DOUBLE_KICK,
    snare: BACKBEAT,
    hat: 2,
    chug: GALLOP,
    hits: [0, 6, 10],
    lead: 0.4,
    weight: 1,
  },

  // Game day. The full gallop, a screaming lead, no mercy.
  gameday: {
    root: 40,
    scale: PHRYGIAN,
    bpm: 158,
    progression: [0, 1, 0, 5],
    kick: DOUBLE_KICK,
    snare: BACKBEAT,
    hat: 1,
    chug: GALLOP,
    hits: [0, 4, 8, 12],
    lead: 0.5,
    weight: 1.05,
  },

  // January: slower and heavier, every hit with more weight behind it.
  playoffs: {
    root: 36,
    scale: HARMONIC_MINOR,
    bpm: 144,
    progression: [0, 6, 5, 0],
    kick: DOUBLE_KICK,
    snare: BACKBEAT,
    hat: 2,
    chug: GALLOP,
    hits: [0, 3, 6, 10],
    lead: 0.45,
    weight: 1.1,
  },

  // You won it. Major, loud, and ridiculous.
  champion: {
    root: 43,
    scale: MIXOLYDIAN,
    bpm: 150,
    progression: [0, 3, 4, 0],
    kick: EVERY_BEAT.concat([2, 6, 10, 14]),
    snare: BACKBEAT,
    hat: 2,
    chug: EIGHTHS,
    hits: [0, 4, 8, 12],
    lead: 0.6,
    weight: 1,
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

/** How many bars a phrase runs before the riser and the crash. */
const PHRASE = 4;

/**
 * Compose and schedule one bar.
 *
 * Sixteen steps. Drums from the mood's patterns, the guitar chugging the chord
 * root with a full power chord on the accents, a growling sub underneath, a
 * lead line over the top, a crash on the first bar of each phrase and a riser
 * through the last bar into it.
 */
export function scheduleBar(mood: Mood, bar: number, at: number, dest: AudioNode): void {
  const beat = 60 / mood.bpm;
  const step = beat / 4;
  const barLen = beat * 4;
  const degree = mood.progression[bar % mood.progression.length] ?? 0;
  const rand = rngFor(bar, mood.root);
  const w = mood.weight;
  const phraseBar = bar % PHRASE;

  // drums
  for (const s of mood.kick) {
    kick(dest, { when: at + step * s, gain: (s % 4 === 0 ? 0.62 : 0.5) * w });
  }
  for (const s of mood.snare) snare(dest, { when: at + step * s, gain: 0.5 * w });
  for (let s = 0; s < 16; s += mood.hat) {
    noise(dest, {
      when: at + step * s,
      dur: 0.04,
      gain: (s % 4 === 0 ? 0.05 : 0.032) * w,
      center: 8200,
      q: 1.8,
    });
  }
  // a fill on the last two steps of a phrase
  if (phraseBar === PHRASE - 1) {
    for (const s of [12, 13, 14, 15]) snare(dest, { when: at + step * s, gain: (0.3 + 0.05 * (s - 12)) * w });
  }
  if (phraseBar === 0) crash(dest, { when: at, gain: 0.2 * w });

  // the guitar: palm-muted chugs on the root, full chords on the accents
  const rootFreq = hz(noteAt(mood, degree, -1));
  const chug = new Set(mood.chug);
  const hits = new Set(mood.hits);
  for (let s = 0; s < 16; s++) {
    if (hits.has(s)) {
      riff(dest, { when: at + step * s, freq: rootFreq, dur: step * 3.4, gain: 0.3 * w, power: true });
    } else if (chug.has(s)) {
      // the odd chug drops to the flat second, the way a riff leans on a note
      const note = phraseBar === 3 && s >= 12 && rand() < 0.4 ? noteAt(mood, degree + 1, -1) : noteAt(mood, degree, -1);
      riff(dest, { when: at + step * s, freq: hz(note), dur: step * 0.9, gain: 0.26 * w, mute: true });
    }
  }
  growl(dest, { when: at, freq: rootFreq / 2, dur: beat * 1.9, gain: 0.34 * w });
  growl(dest, { when: at + beat * 2, freq: rootFreq / 2, dur: beat * 1.9, gain: 0.3 * w });

  // the lead: eighth notes, mostly rests, from the chord and its neighbours
  if (phraseBar % 2 === 1) {
    for (let s = 0; s < 8; s++) {
      if (rand() > mood.lead) continue;
      const pick = [0, 2, 4, 6, 1, 7][Math.floor(rand() * 6)] ?? 0;
      lead(dest, {
        when: at + (barLen / 8) * s,
        freq: hz(noteAt(mood, degree + pick, 2)),
        dur: (barLen / 8) * (rand() < 0.35 ? 1.8 : 0.9),
        gain: 0.16 + rand() * 0.06,
      });
    }
  }

  if (phraseBar === PHRASE - 1) riser(dest, { when: at, dur: barLen, gain: 0.12 * w });
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
      // a shouted line over the top, every other phrase, once the groove is up
      if (this.bar > 0 && this.bar % (PHRASE * 2) === 2) {
        shout(name, this.bar, Math.max(0, (this.nextBarAt - ctx.currentTime) * 1000));
      }
      this.bar += 1;
      this.nextBarAt += barLen;
    }
  }
}

export { MOODS };
