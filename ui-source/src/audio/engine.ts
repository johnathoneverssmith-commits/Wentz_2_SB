/**
 * The audio engine: one context, two buses, and a switch the player controls.
 *
 * Everything this app plays is **synthesised at runtime**. There is not a
 * single audio file in the bundle, which is three decisions at once and all
 * of them deliberate:
 *
 *  - **Licensing.** Nothing is sampled, borrowed or downloaded. The music is
 *    generated from oscillators and noise by code in `score.ts`, so there is
 *    no question about what may be shipped with it.
 *  - **The standalone build.** `dist/index.html` is one file meant to be
 *    opened from disk and played offline. A soundtrack as audio files would
 *    add megabytes of base64 to it; as code it adds a few kilobytes.
 *  - **It can follow the game.** A recording has one tempo and one key. A
 *    generated score can lean on the draft clock, lift when you win, and sit
 *    back when you're reading a cap table.
 *
 * ## Why it starts silent
 *
 * Browsers refuse to start an `AudioContext` without a gesture, and a
 * franchise sim that begins playing music at you unbidden would deserve to be
 * closed. So sound is off until the player asks for it, the choice is
 * remembered, and the control says so plainly. `unlock()` is called from the
 * click that enables it — the one moment a context is allowed to start.
 */

const STORAGE_KEY = "nfl-sim-ui.audio";

export interface AudioPrefs {
  /** Master switch. Off until the player turns it on. */
  enabled: boolean;
  /** 0–1. The score sits well under the cues by default. */
  musicVolume: number;
  sfxVolume: number;
}

const DEFAULTS: AudioPrefs = { enabled: false, musicVolume: 0.34, sfxVolume: 0.6 };

function loadPrefs(): AudioPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const saved = JSON.parse(raw) as Partial<AudioPrefs>;
    return {
      enabled: saved.enabled ?? DEFAULTS.enabled,
      musicVolume: clamp01(saved.musicVolume ?? DEFAULTS.musicVolume),
      sfxVolume: clamp01(saved.sfxVolume ?? DEFAULTS.sfxVolume),
    };
  } catch {
    // a private window, a full quota, a browser that blocks storage — none of
    // which is a reason to be unable to play a sound
    return { ...DEFAULTS };
  }
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private prefs: AudioPrefs = loadPrefs();
  private listeners = new Set<() => void>();

  get settings(): Readonly<AudioPrefs> {
    return this.prefs;
  }

  /** True once there is a running context — i.e. a gesture has unlocked one. */
  get live(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private announce(): void {
    for (const fn of this.listeners) fn();
  }

  private save(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // the preference not sticking is not worth breaking playback over
    }
  }

  /**
   * Start (or resume) the context. Must be called from a user gesture.
   *
   * Safari and Chrome both park a context created outside one in `suspended`,
   * and resuming it later from a timer does nothing. So every path that turns
   * sound on runs through here, synchronously inside the click.
   */
  unlock(): void {
    if (typeof window === "undefined") return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.prefs.musicVolume;
      this.musicBus.connect(this.master);

      // A gentle limiter on the whole mix. Several cues can land together —
      // a touchdown while the crowd is still up — and without this the sum
      // clips, which sounds like a fault rather than like loudness.
      const squeeze = this.ctx.createDynamicsCompressor();
      squeeze.threshold.value = -12;
      squeeze.knee.value = 12;
      squeeze.ratio.value = 6;
      squeeze.attack.value = 0.004;
      squeeze.release.value = 0.18;
      squeeze.connect(this.master);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.prefs.sfxVolume;
      this.sfxBus.connect(squeeze);
    }
    void this.ctx.resume();
    this.announce();
  }

  setEnabled(on: boolean): void {
    this.prefs = { ...this.prefs, enabled: on };
    this.save();
    if (on) this.unlock();
    else void this.ctx?.suspend();
    this.announce();
  }

  setMusicVolume(v: number): void {
    this.prefs = { ...this.prefs, musicVolume: clamp01(v) };
    this.save();
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setTargetAtTime(this.prefs.musicVolume, this.ctx.currentTime, 0.05);
    }
    this.announce();
  }

  setSfxVolume(v: number): void {
    this.prefs = { ...this.prefs, sfxVolume: clamp01(v) };
    this.save();
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(this.prefs.sfxVolume, this.ctx.currentTime, 0.05);
    }
    this.announce();
  }

  /** Null whenever sound is off or no gesture has unlocked a context yet. */
  get context(): AudioContext | null {
    return this.prefs.enabled ? this.ctx : null;
  }

  get music(): GainNode | null {
    return this.prefs.enabled ? this.musicBus : null;
  }

  get sfx(): GainNode | null {
    return this.prefs.enabled ? this.sfxBus : null;
  }

  /** Seconds on the audio clock, or 0 when there is no clock. */
  now(): number {
    return this.ctx?.currentTime ?? 0;
  }
}

/** One engine for the app. Audio hardware is not a thing to have two of. */
export const audio = new AudioEngine();
