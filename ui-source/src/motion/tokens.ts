import type { Transition } from "framer-motion";

import { type MotionLevel, useMotionLevel } from "./level";

/**
 * The game's motion vocabulary, in one place.
 *
 * The same few moves at two scales. `scale` stretches durations (cinematic
 * moments are long; routine ones are brisk) and every curve is one of the
 * handful the CSS already uses (`--ease`, `--ease-soft`), so the DOM
 * transitions and the Framer ones feel like one hand.
 */
export const EASE = [0.16, 0.84, 0.28, 1] as const;
export const EASE_SOFT = [0.33, 0, 0.2, 1] as const;
/** leaves late, lands hard: the reveal curve */
export const EASE_IMPACT = [0.2, 1.2, 0.3, 1] as const;

export interface Motion {
  level: MotionLevel;
  /** nothing moves */
  off: boolean;
  /** the broadcast package */
  full: boolean;
  /** seconds for a routine movement */
  dur: number;
  /** seconds for a cinematic moment */
  moment: number;
  /** a shared transition for ordinary entrances */
  enter: Transition;
  /** delay between rows of a staggered list */
  stagger: number;
}

const BY_LEVEL: Record<MotionLevel, Omit<Motion, "level" | "off" | "full">> = {
  full: { dur: 0.32, moment: 1.4, enter: { duration: 0.32, ease: EASE }, stagger: 0.03 },
  subtle: { dur: 0.16, moment: 0.5, enter: { duration: 0.16, ease: EASE }, stagger: 0.012 },
  off: { dur: 0, moment: 0, enter: { duration: 0 }, stagger: 0 },
};

export function motionFor(level: MotionLevel): Motion {
  return { level, off: level === "off", full: level === "full", ...BY_LEVEL[level] };
}

export function useMotion(): Motion {
  return motionFor(useMotionLevel());
}
