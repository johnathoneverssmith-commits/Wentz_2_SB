import { domAnimation, LazyMotion, MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Loads Framer Motion's DOM features once for the whole app, lazily, and
 * lets it respect the OS's reduce-motion setting. Components import `m`
 * (the light component) rather than `motion`, which is what keeps the cost
 * to the slimmed-down feature set instead of the full library.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
