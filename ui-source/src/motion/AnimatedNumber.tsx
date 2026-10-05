import { animate, useMotionValue, useMotionValueEvent } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { EASE, useMotion } from "./tokens";

/**
 * A number that counts to its new value instead of snapping.
 *
 * Used for anything a GM watches change: a score, cap space, a rating after
 * camp. The first value it ever shows is shown immediately (counting up from
 * zero on every screen open would be noise); only a *change* animates, and
 * with motion off it never does. `format` renders each frame, so currency
 * and decimals stay exact at every step.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  duration,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  /** seconds; defaults to the level's routine duration, longer in full */
  duration?: number;
  className?: string;
}) {
  const motion = useMotion();
  const mv = useMotionValue(value);
  const [shown, setShown] = useState(value);
  const first = useRef(true);

  useMotionValueEvent(mv, "change", (v) => setShown(v));

  useEffect(() => {
    if (first.current) {
      first.current = false;
      mv.set(value);
      setShown(value);
      return;
    }
    if (motion.off) {
      mv.set(value);
      setShown(value);
      return;
    }
    const controls = animate(mv, value, { duration: duration ?? (motion.full ? 0.9 : 0.3), ease: EASE });
    return () => controls.stop();
  }, [value, motion.off, motion.full, duration, mv]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {format(shown)}
    </span>
  );
}
