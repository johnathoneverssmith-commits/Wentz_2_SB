/**
 * What the audit covers: viewports, franchises, conditions. One place, so the report's coverage matrix and the
 * captures cannot drift apart. Every list can be narrowed from the environment for a quick run; a narrowed run says so
 * in its manifest (see `runScope`) so it can never be mistaken for the full baseline.
 */

export interface Viewport {
  id: string;
  width: number;
  height: number;
  /** A touch-first width: the 44 px target rule applies at full strength. */
  touch: boolean;
}

export const VIEWPORTS: readonly Viewport[] = [
  { id: "1440", width: 1440, height: 900, touch: false },
  { id: "1280", width: 1280, height: 800, touch: false },
  { id: "768", width: 768, height: 1024, touch: true },
  { id: "390", width: 390, height: 844, touch: true },
  { id: "320", width: 320, height: 640, touch: true },
];

export interface AuditTeam {
  code: string;
  /** Why this team is in the set. */
  why: string;
  /** Required by the brief, or added to cover photo availability / palettes. */
  required: boolean;
}

/** Teams that have a photo in ui-source/public/art/stadiums (the rest get the drawn skyline). Re-derived by a self-check. */
export const TEAMS: readonly AuditTeam[] = [
  { code: "BAL", why: "required; stadium photo; purple/black with a gold accent", required: true },
  { code: "PIT", why: "required; stadium photo; black/gold, the yellow-on-white contrast risk", required: true },
  { code: "CIN", why: "required; NO stadium photo, so the drawn skyline fallback; orange/black", required: true },
  { code: "CHI", why: "required; stadium photo; navy/orange", required: true },
  { code: "LV", why: "required; stadium photo; silver/black, a low-chroma palette", required: true },
  { code: "GB", why: "extra: no photo (skyline); green/gold, a second yellow-accent case", required: false },
  { code: "MIA", why: "extra: no photo (skyline); aqua/orange, a light primary", required: false },
  { code: "LAC", why: "extra: no photo (skyline); powder blue/gold, the lightest primary", required: false },
  { code: "JAX", why: "extra: stadium photo; teal/gold/black", required: false },
  { code: "SEA", why: "extra: stadium photo; navy/neon green", required: false },
];

/** The franchise every screen is captured for; the others get the palette sweep (see PALETTE_SCREENS). */
export const PRIMARY_TEAM = "BAL";

/** Conditions a capture can run under. Each is one switch on the browser context or the page. */
export interface Condition {
  id: string;
  describe: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  /** blocked: Google Fonts aborted (what the guard does anyway). real: the real families, fetched once and cached. */
  fonts: "blocked" | "real";
  /** Force a wide / monospace fallback over the whole page, the way the design's own review did (Verdana, Courier New). */
  fallbackFace?: "wide" | "mono";
}

export const CONDITIONS: Record<string, Condition> = {
  baseline: { id: "baseline", describe: "real fonts, motion allowed, dark OS scheme", colorScheme: "dark", reducedMotion: "no-preference", fonts: "real" },
  "fonts-blocked": { id: "fonts-blocked", describe: "Google Fonts blocked: the system fallbacks the CSS names", colorScheme: "dark", reducedMotion: "no-preference", fonts: "blocked" },
  "reduced-motion": { id: "reduced-motion", describe: "prefers-reduced-motion: reduce", colorScheme: "dark", reducedMotion: "reduce", fonts: "real" },
  "light-scheme": { id: "light-scheme", describe: "OS light scheme (the app is meant to ignore or honour it consistently)", colorScheme: "light", reducedMotion: "no-preference", fonts: "real" },
  "wide-fallback": { id: "wide-fallback", describe: "a wide fallback face forced everywhere (Verdana-like widths)", colorScheme: "dark", reducedMotion: "no-preference", fonts: "blocked", fallbackFace: "wide" },
  "mono-fallback": { id: "mono-fallback", describe: "a monospace fallback forced everywhere (Courier New-like widths)", colorScheme: "dark", reducedMotion: "no-preference", fonts: "blocked", fallbackFace: "mono" },
};

const list = (name: string): string[] | null => {
  const v = process.env[name];
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;
};

export interface RunScope {
  teams: string[];
  viewports: string[];
  conditions: string[];
  screens: string[] | null;
  /** True when anything was narrowed: such a run is a smoke run, never the baseline. */
  narrowed: boolean;
}

/** The scope of this run, from AUDIT_TEAMS / AUDIT_VIEWPORTS / AUDIT_CONDITIONS / AUDIT_SCREENS (comma lists). */
export function runScope(): RunScope {
  const teams = list("AUDIT_TEAMS") ?? TEAMS.map((t) => t.code);
  const viewports = list("AUDIT_VIEWPORTS") ?? VIEWPORTS.map((v) => v.id);
  const conditions = list("AUDIT_CONDITIONS") ?? ["baseline"];
  const screens = list("AUDIT_SCREENS");
  for (const t of teams) if (!TEAMS.some((x) => x.code === t)) throw new Error(`AUDIT_TEAMS names an unknown team: ${t}`);
  for (const v of viewports) if (!VIEWPORTS.some((x) => x.id === v)) throw new Error(`AUDIT_VIEWPORTS names an unknown viewport: ${v}`);
  for (const c of conditions) if (!CONDITIONS[c]) throw new Error(`AUDIT_CONDITIONS names an unknown condition: ${c}`);
  const narrowed = Boolean(list("AUDIT_TEAMS") || list("AUDIT_VIEWPORTS") || list("AUDIT_SCREENS") || (list("AUDIT_CONDITIONS") && conditions.join() !== "baseline"));
  return { teams, viewports, conditions, screens, narrowed };
}
