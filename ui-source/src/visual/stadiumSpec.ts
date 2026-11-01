/**
 * Per-team stadium identity for the shared scene renderer.
 *
 * Honest scope: these are procedurally drawn vector scenes. Each team gets its
 * own roof architecture, city landmarks, terrain, skyline density and colors,
 * so no two teams share a composition, but they are stylised silhouettes
 * *inspired by* each home's character, not hand-illustrated portraits of real
 * stadiums or reproductions of any logo. See docs/VISUAL_IDENTITY.md.
 */
export type Roof = "bowl" | "canopy" | "dome" | "oculus" | "arch" | "sail" | "lattice" | "ring" | "fins" | "glass";
export type Landmark =
  | "mesa" | "saguaro" | "spire" | "cranes" | "clocktower" | "truss" | "suspension" | "lighthouse" | "silos"
  | "rig" | "obelisk" | "palms" | "mountains" | "liberty" | "fountain" | "casino" | "wheel" | "sails" | "hills"
  | "colonnade" | "barn" | "pines" | "steamboat" | "orb" | "capitol" | "needle" | "cityhall";
export type Terrain = "flat" | "hills" | "mountains" | "water" | "desert";

export interface StadiumSpec {
  roof: Roof;
  tiers: 2 | 3;
  landmarks: [Landmark, Landmark];
  terrain: Terrain;
  /** 0 small town .. 1 megacity: how dense the procedural skyline is */
  density: number;
  /** where the stadium sits horizontally, 0.3..0.7 */
  anchor: number;
}

export const NEUTRAL_SPEC: StadiumSpec = { roof: "bowl", tiers: 2, landmarks: ["spire", "truss"], terrain: "flat", density: 0.6, anchor: 0.5 };

const S = (roof: Roof, tiers: 2 | 3, landmarks: [Landmark, Landmark], terrain: Terrain, density: number, anchor = 0.5): StadiumSpec => ({ roof, tiers, landmarks, terrain, density, anchor });

export const STADIUM_SPECS: Record<string, StadiumSpec> = {
  ARI: S("sail", 2, ["mesa", "saguaro"], "desert", 0.35, 0.42),
  ATL: S("oculus", 3, ["spire", "wheel"], "flat", 0.85, 0.56),
  BAL: S("bowl", 2, ["cranes", "clocktower"], "water", 0.6, 0.45),
  BUF: S("bowl", 2, ["silos", "spire"], "water", 0.4, 0.58),
  CAR: S("bowl", 3, ["spire", "pines"], "flat", 0.65, 0.5),
  CHI: S("bowl", 3, ["colonnade", "needle"], "water", 0.95, 0.4),
  CIN: S("canopy", 2, ["suspension", "clocktower"], "water", 0.55, 0.55),
  CLE: S("bowl", 2, ["lighthouse", "spire"], "water", 0.6, 0.45),
  DAL: S("arch", 3, ["orb", "spire"], "flat", 0.85, 0.5),
  DEN: S("canopy", 3, ["mountains", "spire"], "mountains", 0.6, 0.58),
  DET: S("dome", 2, ["spire", "suspension"], "water", 0.65, 0.5),
  GB: S("bowl", 2, ["barn", "silos"], "flat", 0.1, 0.5),
  HOU: S("dome", 2, ["rig", "spire"], "flat", 0.8, 0.46),
  IND: S("canopy", 2, ["obelisk", "spire"], "flat", 0.6, 0.52),
  JAX: S("canopy", 2, ["suspension", "palms"], "water", 0.5, 0.55),
  KC: S("bowl", 3, ["fountain", "spire"], "hills", 0.55, 0.48),
  LAC: S("glass", 3, ["palms", "sails"], "water", 0.7, 0.45),
  LAR: S("glass", 3, ["hills", "palms"], "hills", 0.75, 0.55),
  LV: S("fins", 2, ["casino", "wheel"], "desert", 0.8, 0.45),
  MIA: S("canopy", 2, ["palms", "sails"], "water", 0.8, 0.52),
  MIN: S("sail", 3, ["spire", "truss"], "flat", 0.75, 0.46),
  NE: S("lattice", 2, ["lighthouse", "clocktower"], "hills", 0.3, 0.55),
  NO: S("dome", 2, ["steamboat", "truss"], "water", 0.6, 0.52),
  NYG: S("ring", 3, ["spire", "truss"], "water", 1, 0.46),
  NYJ: S("ring", 3, ["liberty", "spire"], "water", 1, 0.54),
  PHI: S("bowl", 3, ["cityhall", "spire"], "water", 0.8, 0.5),
  PIT: S("bowl", 2, ["truss", "spire"], "hills", 0.65, 0.42),
  SEA: S("canopy", 3, ["needle", "mountains"], "water", 0.75, 0.47),
  SF: S("canopy", 3, ["suspension", "hills"], "water", 0.8, 0.55),
  TB: S("canopy", 2, ["steamboat", "palms"], "water", 0.6, 0.45),
  TEN: S("bowl", 2, ["suspension", "orb"], "water", 0.6, 0.5),
  WAS: S("bowl", 3, ["capitol", "obelisk"], "flat", 0.7, 0.5),
};

export function specFor(team: string | undefined): StadiumSpec {
  return (team && STADIUM_SPECS[team]) || NEUTRAL_SPEC;
}
