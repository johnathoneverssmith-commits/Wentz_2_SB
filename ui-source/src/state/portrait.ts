/**
 * Fictional player portraits: a pure, deterministic description of a face.
 *
 * A portrait is a function of two things only: the player's durable id and the
 * league's id. Not the team, the year, the rating, the age or the name — so a
 * trade, a new season or a position change cannot change a face, and nothing
 * about a real person (a name, a likeness, a photo) is read or inferred. Skin
 * tone, hair and every other trait are drawn independently at random from the
 * hash; they are costume parts, not attributes of anyone. Team colours are not
 * part of the spec: the renderer takes them as props so a traded player's
 * uniform updates and his face does not.
 *
 * ~10^12 distinct specs (see `portraitSignature`); `portrait.test.ts` checks a
 * 20,000-player league for collisions.
 */

export interface PortraitSpec {
  skin: number; // 0..7 index into SKIN
  skinShade: number; // -1..1 fine variation within the tone
  faceW: number; // 0..1 cheek width
  jaw: number; // 0..4 jaw shape
  jawW: number; // 0..1
  hair: number; // 0..9 style
  hairColor: number; // 0..6
  beard: number; // 0..5 style
  brow: number; // 0..3
  browThick: number; // 0..1
  eyeColor: number; // 0..3
  eyeSpacing: number; // 0..1
  noseW: number; // 0..1
  mouthW: number; // 0..1
  earSize: number; // 0..1
  eyeBlack: boolean;
  headband: number; // -1 none, else 0..2 stripe index
  neck: number; // 0..1 neck thickness
  scar: number; // -1 none or 0..1 position
}

export const SKIN = ["#f6d9c3", "#efc4a0", "#e0a97d", "#c98a5b", "#a96b41", "#87502f", "#6a3a22", "#4a2916"] as const;
export const HAIR_COLOR = ["#0e0b09", "#2a1b12", "#4a3020", "#7a4a26", "#b88a4a", "#d9c07a", "#8d8d8d"] as const;
export const EYE_COLOR = ["#2b1a10", "#5a3b1f", "#3b5a3a", "#3a5470"] as const;
export const HAIR_STYLES = ["buzz", "short", "fade", "curls", "waves", "long", "bald", "afro", "topknot", "crop"] as const;
export const BEARD_STYLES = ["none", "stubble", "short", "full", "goatee", "mustache"] as const;

/** `p_rookie_<prospectId>` and the prospect it came from are one person. */
export function portraitKey(playerId: string): string {
  return playerId.replace(/^p_rookie_/, "");
}

function fnv(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Two independent 32-bit hashes folded into a stream, so ids that differ by one character diverge. */
function stream(key: string): () => number {
  let a = fnv(key);
  let b = fnv(`${key}\u0001portrait`) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    b = (Math.imul(b, 1664525) + 1013904223) >>> 0;
    let t = a ^ (b >>> 7);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const q = (x: number): number => Math.round(x * 100) / 100;

/** Weighted pick; weights need not sum to one. */
function pick(r: number, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]! / total;
    if (r < acc) return i;
  }
  return weights.length - 1;
}

export function portraitFor(playerId: string, leagueId: string | number = ""): PortraitSpec {
  const r = stream(`${leagueId}|${portraitKey(playerId)}`);
  const skin = Math.floor(r() * SKIN.length);
  return {
    skin,
    skinShade: q(r() * 2 - 1),
    faceW: q(r()),
    jaw: Math.floor(r() * 5),
    jawW: q(r()),
    hair: pick(r(), [3, 4, 4, 3, 3, 2, 1.2, 1.6, 0.8, 3]),
    hairColor: pick(r(), [34, 26, 18, 9, 6, 3, 1.5]),
    beard: pick(r(), [34, 14, 16, 12, 9, 8]),
    brow: Math.floor(r() * 4),
    browThick: q(r()),
    eyeColor: pick(r(), [50, 32, 9, 9]),
    eyeSpacing: q(r()),
    noseW: q(r()),
    mouthW: q(r()),
    earSize: q(r()),
    eyeBlack: r() < 0.14,
    headband: r() < 0.07 ? Math.floor(r() * 3) : -1,
    neck: q(r()),
    scar: r() < 0.05 ? q(r()) : -1,
  };
}

/** A string that is equal for two specs exactly when every drawn trait is equal. */
export function portraitSignature(s: PortraitSpec): string {
  return [s.skin, s.skinShade, s.faceW, s.jaw, s.jawW, s.hair, s.hairColor, s.beard, s.brow, s.browThick, s.eyeColor, s.eyeSpacing, s.noseW, s.mouthW, s.earSize, s.eyeBlack ? 1 : 0, s.headband, s.neck, s.scar].join("|");
}
