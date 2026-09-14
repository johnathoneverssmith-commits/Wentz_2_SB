/**
 * The instruments. Six of them, built from oscillators and noise.
 *
 * Each voice is a function that takes a destination, a start time on the
 * audio clock, and what to play — and schedules itself. Nothing here holds
 * state or needs cleaning up: a voice creates its nodes, gives them an
 * envelope that ends in silence, and lets them be collected. That is the
 * shape Web Audio wants, and it means a dropped frame can never leave a note
 * hanging.
 *
 * Everything is scheduled against `when` rather than played "now". The
 * scheduler in `score.ts` runs a quarter of a second ahead of the music, so
 * a busy render never turns into a late beat.
 */

export interface VoiceOpts {
  /** Seconds on the audio clock. */
  when: number;
  /** Hz. */
  freq: number;
  /** Seconds. */
  dur: number;
  /** 0–1, before the bus gain. */
  gain?: number;
  /** Cents of detune, for stacking two oscillators into one fatter note. */
  detune?: number;
}

/** Equal temperament from a MIDI note number. A4 = 69 = 440Hz. */
export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * Attack, hold, release — with the release measured back from the end.
 *
 * The first version of this took `release` as the moment the decay *finished*
 * rather than how long it lasted, which meant every note died halfway through
 * its own duration. Pads that were supposed to sustain under a whole bar were
 * silent for the second half of it, and the music came out as a series of
 * unconnected blips with gaps between them. Measuring the RMS on the music
 * bus is what caught it: 16 of 30 sampled frames were silence.
 *
 * So: up over `attack`, hold, and down over `release` ending exactly on
 * `when + dur`. A percussive voice passes `release = dur - attack` and gets a
 * decay that starts immediately; a pad passes something shorter and sustains.
 */
function envelope(
  ctx: BaseAudioContext,
  when: number,
  dur: number,
  peak: number,
  attack: number,
  release: number,
): GainNode {
  const g = ctx.createGain();
  const top = Math.max(0.0002, peak);
  const atk = Math.max(0.002, Math.min(attack, dur * 0.5));
  const rel = Math.max(0.01, Math.min(release, dur - atk));
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(top, when + atk);
  g.gain.setValueAtTime(top, when + dur - rel);
  // exponential down, then a hard zero: ramping to exactly 0 exponentially is
  // undefined, and ramping there linearly clicks
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  g.gain.setValueAtTime(0, when + dur + 0.001);
  return g;
}

/**
 * A soft, wide pad. Two saws a few cents apart through a low-passed filter.
 *
 * This is the bed under most of the moods — it wants to be felt rather than
 * listened to, so the filter sits low and the attack is slow enough that it
 * never announces itself.
 */
export function pad(dest: AudioNode, o: VoiceOpts & { cutoff?: number }): void {
  const ctx = dest.context;
  const g = envelope(ctx, o.when, o.dur, (o.gain ?? 0.2) * 0.5, o.dur * 0.28, o.dur * 0.42);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(o.cutoff ?? 900, o.when);
  filter.Q.value = 0.6;
  g.connect(filter).connect(dest);
  for (const cents of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = o.freq;
    osc.detune.value = cents + (o.detune ?? 0);
    osc.connect(g);
    osc.start(o.when);
    osc.stop(o.when + o.dur + 0.05);
  }
}

/** A short plucked note — the melodic voice. Triangle through a quick decay. */
export function pluck(dest: AudioNode, o: VoiceOpts): void {
  const ctx = dest.context;
  const g = envelope(ctx, o.when, o.dur, o.gain ?? 0.22, 0.006, o.dur - 0.006);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(Math.min(6000, o.freq * 6), o.when);
  filter.frequency.exponentialRampToValueAtTime(Math.max(200, o.freq * 2), o.when + o.dur);
  g.connect(filter).connect(dest);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = o.freq;
  osc.detune.value = o.detune ?? 0;
  osc.connect(g);
  osc.start(o.when);
  osc.stop(o.when + o.dur + 0.05);
}

/** Round, deep, short. Sine with a falling pitch, the way a kick behaves. */
export function bass(dest: AudioNode, o: VoiceOpts): void {
  const ctx = dest.context;
  const g = envelope(ctx, o.when, o.dur, o.gain ?? 0.3, 0.01, o.dur - 0.01);
  g.connect(dest);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(o.freq * 1.02, o.when);
  osc.frequency.exponentialRampToValueAtTime(o.freq, o.when + 0.08);
  osc.connect(g);
  osc.start(o.when);
  osc.stop(o.when + o.dur + 0.05);
}

/**
 * Brass. A stack of odd harmonics with the filter opening as it sounds —
 * the cheapest convincing horn there is, and the right colour for a sport
 * whose music is fanfares.
 */
export function horn(dest: AudioNode, o: VoiceOpts): void {
  const ctx = dest.context;
  const g = envelope(ctx, o.when, o.dur, (o.gain ?? 0.24) * 0.6, 0.045, o.dur * 0.55);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(o.freq * 1.5, o.when);
  filter.frequency.linearRampToValueAtTime(o.freq * 7, o.when + 0.12);
  filter.frequency.linearRampToValueAtTime(o.freq * 3, o.when + o.dur);
  filter.Q.value = 2.5;
  g.connect(filter).connect(dest);
  for (const [mult, level] of [
    [1, 1],
    [2, 0.5],
    [3, 0.32],
    [5, 0.12],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = o.freq * mult;
    osc.detune.value = (o.detune ?? 0) + (mult % 2 === 0 ? 4 : -4);
    const lvl = ctx.createGain();
    lvl.gain.value = level;
    osc.connect(lvl).connect(g);
    osc.start(o.when);
    osc.stop(o.when + o.dur + 0.05);
  }
}

/** White noise through a band-pass — hats, brushes, and the crowd. */
export function noise(
  dest: AudioNode,
  o: { when: number; dur: number; gain?: number; center?: number; q?: number },
): void {
  const ctx = dest.context;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = o.center ?? 4200;
  filter.Q.value = o.q ?? 1.1;
  const g = envelope(ctx, o.when, o.dur, o.gain ?? 0.12, 0.004, o.dur - 0.004);
  src.connect(filter).connect(g).connect(dest);
  src.start(o.when);
  src.stop(o.when + o.dur + 0.02);
}

/**
 * A crowd. Filtered noise that swells and falls, with the filter sweeping up
 * as it rises — which is what a stadium actually sounds like from the field.
 *
 * Longer and quieter than it looks: it is texture under a moment, not an
 * effect in front of one.
 */
export function crowd(
  dest: AudioNode,
  o: { when: number; dur: number; gain?: number; intensity?: number },
): void {
  const ctx = dest.context;
  const frames = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // brown-ish noise: a random walk, which has the low-frequency weight a
  // crowd has and white noise doesn't
  let last = 0;
  for (let i = 0; i < frames; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.09) * 0.985;
    data[i] = last * 3.2;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  const peak = 700 + 900 * (o.intensity ?? 0.6);
  filter.frequency.setValueAtTime(peak * 0.5, o.when);
  filter.frequency.linearRampToValueAtTime(peak, o.when + o.dur * 0.3);
  filter.frequency.linearRampToValueAtTime(peak * 0.6, o.when + o.dur);
  filter.Q.value = 0.8;
  const g = ctx.createGain();
  const level = (o.gain ?? 0.18) * (0.5 + (o.intensity ?? 0.6) * 0.5);
  g.gain.setValueAtTime(0.0001, o.when);
  g.gain.exponentialRampToValueAtTime(level, o.when + o.dur * 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, o.when + o.dur);
  g.gain.setValueAtTime(0, o.when + o.dur + 0.01);
  src.connect(filter).connect(g).connect(dest);
  src.start(o.when);
  src.stop(o.when + o.dur + 0.02);
}
