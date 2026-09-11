import type { Coach, FreePriorities, Player } from "@/domain";

const PRIORITY_TAGS = ["salary", "guaranteed money", "winning now", "a starting role", "scheme fit", "location"];

function seededFloat(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = (h ^ id.charCodeAt(i)) * 16777619;
  return ((h >>> 0) % 1000) / 1000;
}

/** Stable 3-tag ranking from an id. */
function rankTags(id: string, tags: string[]): string[] {
  return tags
    .map((t, i) => ({ t, k: seededFloat(id + t, i * 17 + 1) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 3)
    .map((x) => x.t);
}

/** A free-agent player's negotiation priorities + opening expectation. */
export function playerPriorities(p: Player): FreePriorities {
  const ranked = rankTags(p.id, PRIORITY_TAGS);
  // older / higher-overall players want more; younger want role & winning
  const base = Math.max(0.9, ((p.overall - 58) / 8) ** 2 + seededFloat(p.id, 7) * 2);
  const years = p.age >= 30 ? 1 + Math.round(seededFloat(p.id, 3)) : 2 + Math.round(seededFloat(p.id, 3) * 2);
  return {
    ranked,
    expectation: {
      baseSalary: round1(base),
      signingBonus: round1(base * (0.3 + seededFloat(p.id, 11) * 0.5)),
      years,
      guaranteed: round1(base * years * (0.35 + seededFloat(p.id, 13) * 0.35)),
    },
  };
}

/** A coach's negotiation priorities + opening expectation. */
export function coachPriorities(c: Coach): FreePriorities {
  const ranked = rankTags(c.id, ["salary", "roster talent", "control of scheme", "front-office trust", "market size"]);
  const iq = c.playCallIq ?? c.gameManagement ?? 70;
  const base = Math.max(1.5, ((iq - 55) / 10) ** 1.6 + seededFloat(c.id, 9) * 2);
  return {
    ranked,
    expectation: {
      baseSalary: round1(base),
      signingBonus: round1(base * 0.4),
      years: 3 + Math.round(seededFloat(c.id, 2)),
      guaranteed: round1(base * 2),
    },
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
