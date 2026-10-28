import { m } from "framer-motion";
import type { ReactNode } from "react";
import { useMotion } from "./tokens";

/** Passive surfaces only: never holds a gameplay route or action alive on exit. */
export function MotionSurface({ children, className = "", index = 0 }: {
  children: ReactNode; className?: string; index?: number;
}) {
  const motion = useMotion();
  if (motion.off) return <section className={className}>{children}</section>;
  return <m.section className={className}
    initial={{ opacity: 0, y: motion.full ? 12 : 4 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -4, transition: { duration: motion.dur / 2 } }}
    transition={{ ...motion.enter, delay: Math.min(8, Math.max(0, index)) * motion.stagger }}>
    {children}
  </m.section>;
}

/** Transform-only fill: no per-frame React renders, with a stable accessible value. */
export function MotionMeter({ value, max = 100, label, tone = "teal" }: {
  value: number; max?: number; label: string; tone?: "teal" | "blue" | "gold" | "purple";
}) {
  const motion = useMotion();
  const ratio = Math.min(1, Math.max(0, value / Math.max(1, max)));
  return <div className={"ui-meter ui-meter--" + tone} role="meter" aria-label={label}
    aria-valuenow={Math.min(max, Math.max(0, value))} aria-valuetext={value + " of " + max} aria-valuemin={0} aria-valuemax={max}>
    {motion.off ? <span style={{ transform: "scaleX(" + ratio + ")" }} /> :
      <m.span initial={{ scaleX: 0 }} animate={{ scaleX: ratio }} transition={motion.enter} />}
  </div>;
}
