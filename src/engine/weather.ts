/**
 * Game-day weather — where the game is played, and when.
 *
 * Every game used to be played in the same still, dry, 60-degree air: a
 * December game in Buffalo and a September one in a dome were identical.
 * Real weather moves real games in a few specific, well-measured ways, and
 * those are the only ones modelled here:
 *
 *  - **wind** is the big one: it takes completions away from the throws that
 *    hang in the air longest, and range and accuracy away from kickers and
 *    punters (past ~15 mph, long field goals fall off sharply)
 *  - **rain and snow** make the ball slick: more fumbles, a few more
 *    incompletions
 *  - **cold** stiffens the ball and the hands, a little; it is the smallest
 *    of the three
 *  - **altitude** (Denver) carries the ball: longer kicks and punts
 *
 * Domes and closed roofs play in neutral conditions.
 *
 * Deterministic, and it spends none of the game's random numbers: the
 * conditions are a hash of the venue, the week and the game's seed, so a
 * replay at the same seed has the same weather, and the box score can say
 * what it was before the game is played. A game without a `weather` option
 * plays in neutral air exactly as before.
 */

export interface Weather {
  /** degrees Fahrenheit */
  tempF: number;
  windMph: number;
  precip: "none" | "rain" | "snow";
  /** played under a roof — conditions are neutral whatever the sky */
  indoor: boolean;
  /** feet above sea level, for the kicking game */
  altitudeFt: number;
}

/**
 * Per venue: [September mean °F, December mean °F, windiness 0–1, how often a
 * game sees rain or snow, roof]. Roof: 0 open, 1 dome / fixed, 2 retractable
 * (closed in bad weather, so effectively indoor).
 */
const VENUES: Record<string, [number, number, number, number, 0 | 1 | 2]> = {
  ARI: [95, 66, 0.2, 0.05, 2],
  ATL: [80, 52, 0.2, 0.25, 1],
  BAL: [76, 42, 0.45, 0.28, 0],
  BUF: [68, 31, 0.85, 0.42, 0],
  CAR: [80, 50, 0.3, 0.27, 0],
  CHI: [70, 30, 0.85, 0.32, 0],
  CIN: [74, 37, 0.4, 0.3, 0],
  CLE: [70, 34, 0.8, 0.38, 0],
  DAL: [88, 55, 0.4, 0.15, 2],
  DEN: [72, 37, 0.45, 0.18, 0],
  DET: [70, 33, 0.4, 0.3, 1],
  GB: [66, 23, 0.6, 0.33, 0],
  HOU: [90, 62, 0.3, 0.25, 2],
  IND: [75, 34, 0.4, 0.3, 2],
  JAX: [84, 62, 0.35, 0.3, 0],
  KC: [76, 35, 0.6, 0.25, 0],
  LAC: [78, 66, 0.2, 0.06, 1],
  LAR: [78, 66, 0.2, 0.06, 1],
  LV: [92, 55, 0.3, 0.03, 1],
  MIA: [88, 74, 0.45, 0.32, 0],
  MIN: [68, 20, 0.5, 0.25, 1],
  NE: [70, 34, 0.7, 0.35, 0],
  NO: [85, 60, 0.3, 0.3, 1],
  NYG: [74, 40, 0.65, 0.3, 0],
  NYJ: [74, 40, 0.65, 0.3, 0],
  PHI: [76, 41, 0.5, 0.3, 0],
  PIT: [72, 36, 0.5, 0.33, 0],
  SEA: [68, 46, 0.4, 0.42, 0],
  SF: [76, 57, 0.6, 0.18, 0],
  TB: [88, 68, 0.35, 0.3, 0],
  TEN: [82, 44, 0.4, 0.3, 0],
  WAS: [78, 42, 0.45, 0.28, 0],
};
const ALTITUDE: Record<string, number> = { DEN: 5280, ARI: 1100, LV: 2000, KC: 900 };

/** Neutral conditions — what every game was played in before this. */
export const NEUTRAL_WEATHER: Weather = { tempF: 60, windMph: 0, precip: "none", indoor: true, altitudeFt: 0 };

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The conditions for one game. `week` is the season week (preseason 0 or
 * below, playoffs 19+); `seed` the game's own seed, so two games at the same
 * venue in the same week differ.
 */
export function gameWeather(homeTeam: string, week: number, seed: number): Weather {
  const v = VENUES[homeTeam];
  if (!v) return { ...NEUTRAL_WEATHER, indoor: false };
  const [sep, dec, windy, wet, roof] = v;
  const altitudeFt = ALTITUDE[homeTeam] ?? 0;
  if (roof !== 0) return { ...NEUTRAL_WEATHER, altitudeFt };
  // a season runs August (preseason) to February; temperature falls roughly
  // linearly from week 1 (September) to week 16 (late December) and holds
  const t = Math.max(-0.25, Math.min(1.25, (week - 1) / 15));
  const h = hash(`${homeTeam}|${week}|${seed}`);
  const u = (shift: number) => ((h >>> shift) & 0xff) / 255;
  const tempF = Math.round(sep + (dec - sep) * t + (u(0) - 0.5) * 18);
  // wind: mostly calm-to-breezy, with a long tail on the windy sites
  const windMph = Math.round(Math.max(0, 4 + windy * 10 + (u(8) - 0.35) * (8 + windy * 18)));
  const precip = u(16) < wet * 0.6 ? (tempF <= 33 ? "snow" : "rain") : "none";
  return { tempF, windMph, precip, indoor: false, altitudeFt };
}

/** What the conditions do to a game, in the engine's units. All zero indoors. */
export interface WeatherEffect {
  /** COMPLETE logit, by air-yard bucket */
  complete: Record<string, number>;
  /** FG MADE logit, scaled by kick distance (yards beyond 30, per yard) */
  fgPerYard: number;
  /** FG MADE logit, flat */
  fg: number;
  /** yards on a punt's gross distance */
  punt: number;
  /** multiplier on the fumble probability */
  fumble: number;
}

export const NO_WEATHER_EFFECT: WeatherEffect = {
  complete: {},
  fgPerYard: 0,
  fg: 0,
  punt: 0,
  fumble: 1,
};

/**
 * Sizes from the published weather studies (wind past ~10 mph: about −1
 * point of completion % per 3 mph on downfield throws, long field goals
 * −1.5% a mph past 10; rain and snow ~+25–35% fumbles; sub-25°F a point or
 * two of completion %; Denver's air ~+4 yards of kick range).
 */
export function weatherEffect(w: Weather | null | undefined): WeatherEffect {
  if (!w || w.indoor) {
    if (w && w.altitudeFt > 3000) return { ...NO_WEATHER_EFFECT, fgPerYard: 0.012, punt: 2 };
    return NO_WEATHER_EFFECT;
  }
  const wind = Math.max(0, w.windMph - 10);
  const cold = Math.max(0, 25 - w.tempF) / 10;
  const wet = w.precip === "snow" ? 1.4 : w.precip === "rain" ? 1 : 0;
  const base = -0.06 * wet - 0.04 * cold;
  const alt = w.altitudeFt > 3000 ? 1 : 0;
  return {
    complete: {
      BEHIND_LOS: base,
      SHORT: base - 0.004 * wind,
      INTERMEDIATE: base - 0.012 * wind,
      DEEP: base - 0.022 * wind,
    },
    fgPerYard: -0.0045 * wind - 0.002 * cold + 0.012 * alt,
    fg: -0.06 * wet - 0.04 * cold,
    punt: -0.35 * wind - 1.0 * cold + 2 * alt,
    fumble: 1 + 0.3 * wet + 0.05 * cold,
  };
}

/** "34°F, wind 18 mph, snow" / "Indoors" — for the game header and box score. */
export function describeWeather(w: Weather | null | undefined): string {
  if (!w) return "";
  if (w.indoor) return "Indoors";
  const parts = [`${w.tempF}°F`, w.windMph >= 5 ? `wind ${w.windMph} mph` : "calm"];
  if (w.precip !== "none") parts.push(w.precip);
  return parts.join(", ");
}

/**
 * The conditions for a franchise game, from the phase and week it is played
 * in: the preseason is August, the regular season runs September to early
 * January, the playoffs January to February. A neutral site (the Super Bowl)
 * plays under a roof. Every caller that plays or replays a franchise game goes
 * through this, so the box score, the broadcast and the replay agree.
 */
export function weatherFor(homeTeam: string, phase: string, week: number, seed: number, neutralSite = false): Weather {
  if (neutralSite) return NEUTRAL_WEATHER;
  const code = homeTeam === "LA" ? "LAR" : homeTeam;
  const ROUND_WEEK: Record<string, number> = { WC: 19, DIV: 20, CONF: 21, SB: 22 };
  const p = phase.replace(/^PO-/, "");
  const w = p === "PRE" ? week - 4 : p === "REG" ? week : (ROUND_WEEK[p] ?? 20);
  return gameWeather(code, w, seed);
}
