import { m } from "framer-motion";
import type { ReactNode } from "react";

import { EASE, useMotion } from "./tokens";

/**
 * Wraps the routed screen so a change of screen is a movement rather than a
 * swap. Keyed by the caller on the route: a new key remounts it and the
 * entrance plays. Enter-only on purpose: an exit animation holds the old
 * screen on top of the new one, and a game that is waiting on the next
 * screen shouldn't wait on the last one's goodbye.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  const motion = useMotion();
  if (motion.off) return <>{children}</>;
  return (
    <m.div
      initial={{ opacity: 0, x: motion.full ? 18 : 0, y: motion.full ? 0 : 4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: motion.full ? 0.26 : 0.14, ease: EASE }}
    >
      {children}
    </m.div>
  );
}
