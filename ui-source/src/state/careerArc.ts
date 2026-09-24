import type { Player } from "@/domain";

/**
 * Where a player is in his career, from the thresholds the aging model uses:
 * still improving, at his peak, or past it. A GM deciding who to sign,
 * extend or trade reads this more than the number beside it.
 */
export function careerArc(p: Pick<Player, "age" | "dev_age_threshold" | "decline_age_threshold">): {
  label: "Rising" | "Prime" | "Declining";
  color: string;
  hint: string;
} {
  if (p.age < p.dev_age_threshold) return { label: "Rising", color: "var(--good)", hint: `Still developing until about ${p.dev_age_threshold}` };
  if (p.age < p.decline_age_threshold) return { label: "Prime", color: "var(--ink-faint)", hint: `In his prime until about ${p.decline_age_threshold}` };
  return { label: "Declining", color: "var(--bad)", hint: `Past his decline age (${p.decline_age_threshold})` };
}
