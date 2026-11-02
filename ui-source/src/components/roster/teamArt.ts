import { contrastRatio, mixToward, onColorFor, relativeLuminance, TEAMS_BY_CODE } from "@/data/teams";

/**
 * The roster masthead's team identity: its colours, its stadium photo, and
 * the drawn skyline that stands in where there is no photo.
 *
 * Everything here is keyed by team code and never throws for a code it
 * doesn't know — a league can be fictional, and a missing entry falls back to
 * a neutral team rather than a crash.
 */

// ---- colours ---------------------------------------------------------------

const NEUTRAL = "#3b6f99";
const PAPER = "#ffffff";
const ORANGE = "#ff5b1f";
const YELLOW = "#ffcc33";

export interface MastheadPalette {
  /** the masthead fill: the team primary, lifted off near-black */
  bg: string;
  /** text on the masthead: whichever of black or white reads on `bg` */
  ink: string;
  /** the screen's one accent, as a fill */
  accent: string;
  /** text on an accent fill */
  onAccent: string;
  /** the accent darkened until it reads as text on white */
  accentText: string;
}

function hue(hex: string): { h: number; s: number } {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const l = (max + min) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s };
}

/**
 * A team colour the masthead can be filled with. The dark navies and the
 * Raiders' black are lifted toward white until they read as a colour rather
 * than as night; the light primaries (the Steelers' gold) are left alone and
 * get dark text instead.
 */
export function mastheadBg(color: string): string {
  let c = color;
  let guard = 0;
  while (relativeLuminance(c) < 0.05 && guard++ < 24) c = mixToward(c, "#ffffff", 0.06);
  return c;
}

/** Darken `color` until it reaches `ratio` against `bg`. */
export function darkenUntil(color: string, bg: string, ratio: number): string {
  let c = color;
  let guard = 0;
  while (contrastRatio(c, bg) < ratio && guard++ < 30) c = mixToward(c, "#000000", 0.08);
  return c;
}

/**
 * White type where the team colour can take it. A mid-tone primary (the
 * Panthers' blue, the Bengals' orange) is darkened a little until white reads
 * at body-text contrast; a light one (the Steelers' gold) would have to turn
 * brown to get there, so it keeps its colour and takes dark type instead.
 */
function forWhiteType(bg: string): string {
  let c = bg;
  for (let step = 0; step < 5 && contrastRatio(c, "#ffffff") < 4.5; step++) c = mixToward(c, "#000000", 0.06);
  return contrastRatio(c, "#ffffff") >= 4.5 ? c : bg;
}

export function mastheadPalette(code: string): MastheadPalette {
  const bg = forWhiteType(mastheadBg(TEAMS_BY_CODE[code]?.color ?? NEUTRAL));
  const { h, s } = hue(bg);
  // orange disappears against a red or orange team, so those get yellow
  const warm = s > 0.35 && (h < 45 || h > 330);
  const accent = warm ? YELLOW : ORANGE;
  return {
    bg,
    ink: onColorFor(bg),
    accent,
    onAccent: onColorFor(accent),
    accentText: darkenUntil(accent, PAPER, 4.5),
  };
}

// ---- stadium photos ----------------------------------------------------------

export interface PhotoCredit {
  title: string;
  author: string;
  license: string;
  /** the Wikimedia Commons file page, which carries the full licence terms */
  source: string;
}

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;
const photo = (file: string, author: string, license: string): PhotoCredit => ({
  title: file.replace(/\.[a-z]+$/i, ""),
  author,
  license,
  source: commons(file),
});

/**
 * Credits for the photos shipped in public/art/stadiums. Every one is openly
 * licensed, and the CC BY and CC BY-SA ones require the credit to be shown
 * with the image — the masthead prints it. A file dropped into that folder
 * for a team that isn't listed here (an image the user made themselves) is
 * shown without a credit line.
 */
export const STADIUM_PHOTO_CREDITS: Readonly<Record<string, PhotoCredit>> = {
  ARI: photo("State Farm Stadium Super Bowl LVII by Gage Skidmore.jpg", "Gage Skidmore", "CC BY-SA 3.0"),
  ATL: photo("Mercedes-Benz Stadium, December 2024.jpg", "BullDawg2021", "CC BY 4.0"),
  BAL: photo("M&T Bank Stadium in Baltimore.jpg", "Quintin Soloviev", "CC BY 4.0"),
  BUF: photo("Highmark Stadium in 2023 - Quintin Soloviev.jpg", "Quintin Soloviev", "CC BY-SA 4.0"),
  CAR: photo("Aerial view of Bank of America Stadium in Charlotte.jpg", "Quintin Soloviev", "CC BY 4.0"),
  CHI: photo("Soldier Field on June 26, 2020.jpg", "Moses8910", "CC BY-SA 4.0"),
  CLE: photo("Cleveland August 2015 08 (FirstEnergy Stadium).jpg", "Michael Barera", "CC BY-SA 4.0"),
  DAL: photo("Arlington June 2020 1 (AT&T Stadium).jpg", "Michael Barera", "CC BY-SA 4.0"),
  DEN: photo("Empower Field at Mile High, 2025.jpg", "MhcL947", "CC BY 4.0"),
  HOU: photo("NRG Stadium, Houston, Texas, United States.jpg", "U.S. Customs and Border Protection", "Public domain"),
  JAX: photo("EverBank Stadium aerial view.jpg", "Quintin Soloviev", "CC BY 4.0"),
  LV: photo("Allegiant Stadium Street View on Super Bowl LVIII.jpg", "U.S. Customs and Border Protection", "Public domain"),
  NO: photo("Caesars Superdome - Home of the New Orleans Saints - 4 Feb 2026.jpg", "ajay_suresh", "CC BY 4.0"),
  PIT: photo("Acrisure Stadium, North Shore, 2026-10-22.jpg", "Cbaile19", "CC0"),
  SEA: photo("Lumen Field north side at dusk.jpg", "SounderBruce", "CC BY-SA 4.0"),
  TB: photo("Raymond James Stadium (2021) B.jpg", "U.S. Customs and Border Protection", "Public domain"),
  TEN: photo("Nissan Stadium 2022.jpg", "Antony-22", "CC BY-SA 4.0"),
};

/** Where most of each photo's interest sits, for `object-position`. */
const PHOTO_FOCUS: Readonly<Record<string, string>> = {
  ARI: "50% 70%", CHI: "50% 42%", DAL: "50% 60%", HOU: "50% 62%", JAX: "50% 55%", LV: "50% 72%", TB: "50% 60%",
};

/**
 * The photo for a team, by code. Every team is tried: a file added to
 * public/art/stadiums later is picked up with no code change, and one that
 * isn't there falls back to the drawn skyline when it fails to load.
 * Relative to the page, because the build is served from `./` and also opened
 * straight from disk.
 */
export function stadiumPhotoUrl(code: string): string {
  return `${import.meta.env.BASE_URL ?? "./"}art/stadiums/${encodeURIComponent(code)}.webp`;
}

export function stadiumPhotoFocus(code: string): string {
  return PHOTO_FOCUS[code] ?? "50% 55%";
}

// ---- the drawn skyline -------------------------------------------------------

type Landmark =
  | "towers" | "needle" | "empire" | "willis" | "balltower" | "pyramid" | "mountains"
  | "hills" | "bridge" | "harbor" | "palms" | "dome" | "cylinders" | "monument";
type Stadium = "open" | "dome";

/** A recognisable shape for the city where there is one, and the stadium's roof. */
export const TEAM_SKYLINE: Readonly<Record<string, { landmark: Landmark; stadium: Stadium }>> = {
  ARI: { landmark: "mountains", stadium: "open" }, ATL: { landmark: "towers", stadium: "dome" },
  BAL: { landmark: "harbor", stadium: "open" }, BUF: { landmark: "towers", stadium: "open" },
  CAR: { landmark: "towers", stadium: "open" }, CHI: { landmark: "willis", stadium: "open" },
  CIN: { landmark: "bridge", stadium: "open" }, CLE: { landmark: "towers", stadium: "open" },
  DAL: { landmark: "balltower", stadium: "dome" }, DEN: { landmark: "mountains", stadium: "open" },
  DET: { landmark: "cylinders", stadium: "dome" }, GB: { landmark: "hills", stadium: "open" },
  HOU: { landmark: "towers", stadium: "dome" }, IND: { landmark: "towers", stadium: "dome" },
  JAX: { landmark: "palms", stadium: "open" }, KC: { landmark: "towers", stadium: "open" },
  LV: { landmark: "needle", stadium: "dome" }, LAC: { landmark: "palms", stadium: "dome" },
  LAR: { landmark: "palms", stadium: "dome" }, MIA: { landmark: "palms", stadium: "open" },
  MIN: { landmark: "towers", stadium: "dome" }, NE: { landmark: "towers", stadium: "open" },
  NO: { landmark: "dome", stadium: "dome" }, NYG: { landmark: "empire", stadium: "open" },
  NYJ: { landmark: "empire", stadium: "open" }, PHI: { landmark: "towers", stadium: "open" },
  PIT: { landmark: "bridge", stadium: "open" }, SF: { landmark: "pyramid", stadium: "open" },
  SEA: { landmark: "needle", stadium: "open" }, TB: { landmark: "palms", stadium: "open" },
  TEN: { landmark: "towers", stadium: "open" }, WAS: { landmark: "monument", stadium: "open" },
};

/** A small seeded generator, so a team's skyline is the same on every visit. */
function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function landmark(kind: Landmark, x: number, base: number): string {
  const k = "rgba(0,0,0,.30)";
  switch (kind) {
    case "needle":
      return `<path d="M${x - 3} ${base}L${x - 2} ${base - 170}L${x + 2} ${base - 170}L${x + 3} ${base}Z" fill="${k}"/><ellipse cx="${x}" cy="${base - 150}" rx="30" ry="7" fill="${k}"/><path d="M${x - 2} ${base - 170}L${x} ${base - 205}L${x + 2} ${base - 170}Z" fill="${k}"/>`;
    case "empire":
      return `<rect x="${x - 26}" y="${base - 120}" width="52" height="120" fill="${k}"/><rect x="${x - 19}" y="${base - 155}" width="38" height="36" fill="${k}"/><rect x="${x - 12}" y="${base - 185}" width="24" height="31" fill="${k}"/><rect x="${x - 6}" y="${base - 205}" width="12" height="21" fill="${k}"/><rect x="${x - 1.5}" y="${base - 240}" width="3" height="36" fill="${k}"/>`;
    case "willis":
      return `<rect x="${x - 34}" y="${base - 100}" width="68" height="100" fill="${k}"/><rect x="${x - 34}" y="${base - 170}" width="45" height="70" fill="${k}"/><rect x="${x - 22}" y="${base - 215}" width="22" height="45" fill="${k}"/><rect x="${x - 14}" y="${base - 250}" width="8" height="40" fill="${k}"/><rect x="${x - 26}" y="${base - 250}" width="6" height="30" fill="${k}"/>`;
    case "balltower":
      return `<rect x="${x - 4}" y="${base - 170}" width="8" height="170" fill="${k}"/><circle cx="${x}" cy="${base - 185}" r="26" fill="${k}"/><rect x="${x - 1}" y="${base - 230}" width="2" height="22" fill="${k}"/>`;
    case "pyramid":
      return `<path d="M${x - 34} ${base}L${x} ${base - 190}L${x + 34} ${base}Z" fill="${k}"/><rect x="${x - 62}" y="${base - 72}" width="36" height="72" fill="${k}"/>`;
    case "mountains":
      return `<path d="M${x - 300} ${base}L${x - 200} ${base - 120}L${x - 150} ${base - 80}L${x - 60} ${base - 170}L${x + 40} ${base - 90}L${x + 120} ${base - 140}L${x + 240} ${base}Z" fill="rgba(0,0,0,.20)"/>`;
    case "hills":
      return `<path d="M${x - 320} ${base}Q${x - 200} ${base - 90} ${x - 80} ${base - 40}T${x + 160} ${base - 60}T${x + 300} ${base}Z" fill="rgba(0,0,0,.20)"/>`;
    case "bridge":
      return `<rect x="${x - 170}" y="${base - 40}" width="340" height="5" fill="${k}"/><rect x="${x - 80}" y="${base - 130}" width="6" height="130" fill="${k}"/><rect x="${x + 74}" y="${base - 130}" width="6" height="130" fill="${k}"/><path d="M${x - 170} ${base - 40}Q${x - 125} ${base - 70} ${x - 77} ${base - 130}Q${x} ${base - 50} ${x + 77} ${base - 130}Q${x + 125} ${base - 70} ${x + 170} ${base - 40}" stroke="${k}" stroke-width="3" fill="none"/>`;
    case "harbor":
      return `<rect x="${x - 120}" y="${base - 34}" width="240" height="34" fill="rgba(0,0,0,.24)"/><rect x="${x - 60}" y="${base - 100}" width="42" height="68" fill="${k}"/><path d="M${x - 62} ${base - 100}L${x - 39} ${base - 130}L${x - 16} ${base - 100}Z" fill="${k}"/><rect x="${x + 30}" y="${base - 66}" width="50" height="32" fill="${k}"/>`;
    case "palms": {
      let out = "";
      for (let i = 0; i < 4; i++) {
        const px = x - 110 + i * 70;
        const h = 100 + ((i * 37) % 40);
        out += `<path d="M${px} ${base}Q${px + 10} ${base - h / 2} ${px + 4} ${base - h}" stroke="${k}" stroke-width="4" fill="none"/><path d="M${px + 4} ${base - h}q-30 -4 -40 18M${px + 4} ${base - h}q30 -4 40 18M${px + 4} ${base - h}q-12 -22 -34 -18M${px + 4} ${base - h}q12 -22 34 -18" stroke="${k}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      }
      return out;
    }
    case "dome":
      return `<path d="M${x - 120} ${base}L${x - 120} ${base - 60}Q${x} ${base - 170} ${x + 120} ${base - 60}L${x + 120} ${base}Z" fill="${k}"/>`;
    case "cylinders":
      return `<rect x="${x - 14}" y="${base - 190}" width="28" height="190" rx="14" fill="${k}"/><rect x="${x - 62}" y="${base - 120}" width="26" height="120" rx="13" fill="${k}"/><rect x="${x + 36}" y="${base - 120}" width="26" height="120" rx="13" fill="${k}"/><rect x="${x - 62}" y="${base - 120}" width="124" height="14" fill="${k}"/>`;
    case "monument":
      return `<path d="M${x - 9} ${base}L${x - 4} ${base - 230}L${x} ${base - 250}L${x + 4} ${base - 230}L${x + 9} ${base}Z" fill="${k}"/>`;
    case "towers":
      return "";
  }
}

/** The skyline's drawing area: wide and short, cropped from the right by the masthead. */
export const SKYLINE_VIEWBOX = "0 0 1200 330";

/**
 * A city skyline, a landmark and a stadium for `code`, as SVG markup for a
 * `<svg viewBox={SKYLINE_VIEWBOX}>`. Drawn in translucent black so it takes
 * the masthead's own colour; seeded by the code, so it never changes.
 */
export function skylineSvg(code: string): string {
  const team = TEAM_SKYLINE[code] ?? { landmark: "towers" as Landmark, stadium: "open" as Stadium };
  const rand = seeded(code || "team");
  const W = 1200;
  const base = 306;
  const k = (a: number) => `rgba(0,0,0,${a})`;
  const id = `sky-${code.replace(/[^A-Za-z0-9]/g, "") || "team"}`;
  let s = `<defs><linearGradient id="${id}-sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".30"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/></linearGradient><radialGradient id="${id}-glow"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
  s += `<rect width="${W}" height="330" fill="url(#${id}-sg)"/>`;
  s += `<circle cx="${r1(560 + rand() * 160)}" cy="150" r="60" fill="#fff" opacity=".13"/>`;
  const terrain = team.landmark === "mountains" || team.landmark === "hills";
  if (terrain) s += landmark(team.landmark, r1(380 + rand() * 80), base);
  let x = 300 + rand() * 60;
  while (x < W) {
    const w = 24 + rand() * 46;
    const h = 40 + rand() * (team.landmark === "towers" ? 150 : 100);
    s += `<rect x="${r1(x)}" y="${r1(base - h)}" width="${r1(w)}" height="${r1(h)}" fill="${k(0.14)}"/>`;
    x += w + 2 + rand() * 6;
  }
  if (!terrain) s += landmark(team.landmark, r1(640 + rand() * 120), base);
  x = 340 + rand() * 60;
  while (x < W) {
    const w = 20 + rand() * 34;
    const h = 24 + rand() * 70;
    s += `<rect x="${r1(x)}" y="${r1(base - h)}" width="${r1(w)}" height="${r1(h)}" fill="${k(0.3)}"/>`;
    x += w + 3 + rand() * 10;
  }
  const cx = r1(930 + rand() * 60);
  s += `<path d="M${cx - 210} ${base + 24}L${cx - 190} ${base - 30}Q${cx - 175} ${base - 62} ${cx} ${base - 70}Q${cx + 175} ${base - 62} ${cx + 190} ${base - 30}L${cx + 210} ${base + 24}Z" fill="${k(0.52)}"/>`;
  s += `<ellipse cx="${cx}" cy="${base - 50}" rx="150" ry="14" fill="${k(0.7)}"/>`;
  if (team.stadium === "dome") {
    s += `<path d="M${cx - 190} ${base - 30}Q${cx - 160} ${base - 135} ${cx} ${base - 150}Q${cx + 160} ${base - 135} ${cx + 190} ${base - 30}Z" fill="${k(0.4)}" stroke="rgba(255,255,255,.35)" stroke-width="2"/>`;
  } else {
    for (const dx of [-175, -90, 90, 175]) {
      s += `<rect x="${cx + dx - 2}" y="${base - 130}" width="4" height="100" fill="${k(0.6)}"/><rect x="${cx + dx - 14}" y="${base - 142}" width="28" height="12" fill="#fff"/><circle cx="${cx + dx}" cy="${base - 136}" r="40" fill="url(#${id}-glow)" opacity=".7"/>`;
    }
  }
  s += `<rect x="0" y="${base + 10}" width="${W}" height="30" fill="${k(0.55)}"/>`;
  return s;
}
