/**
 * Standings-based atmosphere: one number, `level` in [0, 1] (1 = top of the
 * human-GM rankings, 0 = bottom, 0.5 = neutral), turned into the lighting a
 * stadium scene is drawn with. Pure, so the gradation can be tested.
 */
export interface AtmospherePalette {
  skyTop: string;
  skyMid: string;
  horizon: string;
  glow: string;
  /** 0 dark .. 1 daylight; scales window glow and field light */
  daylight: number;
  /** heavenly light shafts, 0..1 */
  rays: number;
  /** drifting embers, 0..1 */
  embers: number;
  /** low smoke bank, 0..1 */
  smoke: number;
  /** horizon fire glow, 0..1 */
  fire: number;
  /** soft cloud brightness, 0..1 */
  clouds: number;
}

interface Stop extends Omit<AtmospherePalette, never> {
  at: number;
}

const STOPS: readonly Stop[] = [
  { at: 0, skyTop: "#0a0305", skyMid: "#3b0808", horizon: "#ff4a0f", glow: "#ff7a1a", daylight: 0.05, rays: 0, embers: 1, smoke: 1, fire: 1, clouds: 0.1 },
  { at: 0.25, skyTop: "#1a0f1f", skyMid: "#3d1727", horizon: "#9a3328", glow: "#d9622a", daylight: 0.15, rays: 0, embers: 0.45, smoke: 0.55, fire: 0.4, clouds: 0.2 },
  { at: 0.5, skyTop: "#0c1b33", skyMid: "#17304f", horizon: "#2d4f72", glow: "#5e86ad", daylight: 0.3, rays: 0, embers: 0, smoke: 0, fire: 0, clouds: 0.3 },
  { at: 0.75, skyTop: "#2f7fcb", skyMid: "#79b9e8", horizon: "#f2dfb0", glow: "#fff2c4", daylight: 0.7, rays: 0.4, embers: 0, smoke: 0, fire: 0, clouds: 0.7 },
  { at: 1, skyTop: "#8ec9ff", skyMid: "#ffeebd", horizon: "#fff6d8", glow: "#ffffff", daylight: 1, rays: 1, embers: 0, smoke: 0, fire: 0, clouds: 1 },
];

const hex = (c: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
const toHex = (rgb: number[]): string => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number): string => {
  const x = hex(a);
  const y = hex(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * t));
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function atmospherePalette(level: number): AtmospherePalette {
  const t = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0.5));
  let i = 0;
  while (i < STOPS.length - 2 && t > STOPS[i + 1]!.at) i += 1;
  const a = STOPS[i]!;
  const b = STOPS[i + 1]!;
  const k = (t - a.at) / (b.at - a.at);
  return {
    skyTop: mix(a.skyTop, b.skyTop, k),
    skyMid: mix(a.skyMid, b.skyMid, k),
    horizon: mix(a.horizon, b.horizon, k),
    glow: mix(a.glow, b.glow, k),
    daylight: lerp(a.daylight, b.daylight, k),
    rays: lerp(a.rays, b.rays, k),
    embers: lerp(a.embers, b.embers, k),
    smoke: lerp(a.smoke, b.smoke, k),
    fire: lerp(a.fire, b.fire, k),
    clouds: lerp(a.clouds, b.clouds, k),
  };
}

/** A name for the lighting, for screen readers and the rank chip. */
export function atmosphereName(level: number, meaningful: boolean): string {
  if (!meaningful) return "Neutral";
  if (level >= 0.9) return "Heavenly";
  if (level >= 0.65) return "Bright";
  if (level > 0.35) return "Dusk";
  if (level > 0.1) return "Ominous";
  return "Infernal";
}
