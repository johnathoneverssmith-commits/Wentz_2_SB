import { m } from "framer-motion";
import type { ReactNode } from "react";

import { useMotion } from "./tokens";

function isPhone(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 700px)").matches;
}

/**
 * Wraps the routed screen so a change of screen is a movement rather than a
 * swap. Keyed by the caller on the route: a new key remounts it and the
 * entrance plays. Enter-only on purpose: an exit animation holds the old
 * screen on top of the new one, and a game that is waiting on the next
 * screen shouldn't wait on the last one's goodbye.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  const motion = useMotion();
  // The 18px slide-in pushes the screen past the right edge of a phone for the first
  // ~100 ms, which widens the document and shows a sideways scrollbar (Game Day at
  // 390 px measured scrollWidth 395 > 390). A phone gets the vertical settle instead.
  const slide = motion.full && !isPhone();
  if (motion.off) return <>{children}</>;
  return (
    <m.div
      initial={{ opacity: 0, x: slide ? 18 : 0, y: slide ? 0 : 4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={motion.enter}
    >
      {children}
    </m.div>
  );
}
