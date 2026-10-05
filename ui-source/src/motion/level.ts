import { useSyncExternalStore } from "react";

/**
 * How much the interface moves.
 *
 *  - full: the broadcast package: screen slides, count-ups, and the
 *    cinematic moments (a score, a pick, a new job) with their sound
 *  - subtle: the same things at a third of the length, no flourishes
 *  - off: nothing moves; state changes are instant
 *
 * A device setting rather than a league one: how much motion someone can
 * stand is about them and their screen, not the league they're in. With no
 * saved choice it follows the OS's "reduce motion" preference, so someone who
 * has asked their phone for less movement never has to find this switch.
 */
export type MotionLevel = "full" | "subtle" | "off";

const KEY = "fs.motion";
const LEVELS: readonly MotionLevel[] = ["full", "subtle", "off"];

function osPrefersReduced(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function read(): MotionLevel {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && (LEVELS as readonly string[]).includes(saved)) return saved as MotionLevel;
  } catch {
    // private window: fall through to the default
  }
  return osPrefersReduced() ? "off" : "full";
}

let level: MotionLevel = read();
const listeners = new Set<() => void>();

/** Mirrors the level onto <html data-motion>, which the stylesheet reads. */
function apply(): void {
  if (typeof document !== "undefined") document.documentElement.dataset.motion = level;
}
apply();

export function getMotionLevel(): MotionLevel {
  return level;
}

export function setMotionLevel(next: MotionLevel): void {
  if (next === level) return;
  level = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // it just won't be remembered
  }
  apply();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(subscribe, () => level, () => "full" as MotionLevel);
}
