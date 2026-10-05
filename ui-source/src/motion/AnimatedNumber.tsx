import { animate } from "framer-motion";
import { useEffect, useRef } from "react";

import { EASE, useMotion } from "./tokens";

/**
 * A number that counts to its new value instead of snapping.
 *
 * Used for anything a GM watches change: a score, cap space, a rating after
 * camp. The first value it ever shows is shown immediately (counting up from
 * zero on every screen open would be noise); only a *change* animates, and
 * with motion off it never does. `format` renders each frame, so currency
 * and decimals stay exact at every step.
 *
 * Each frame writes the text straight into the span rather than through
 * React state: a count is sixty updates a second, and re-rendering a
 * component (and whatever it sits in) for each was the most expensive thing
 * the motion system did. React renders the final value; the frames between
 * are the DOM's business.
 */
export function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  duration,
  className,
  from,
}: {
  value: number;
  /** count up from this on first appearance (a result being revealed); omitted, the first value just shows */
  from?: number;
  format?: (n: number) => string;
  /** seconds; defaults to the level's routine duration, longer in full */
  duration?: number;
  className?: string;
}) {
  const motion = useMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(from ?? value);
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    const from = shown.current;
    // nothing to watch in a background tab (and no frames to draw it with):
    // land on the value now rather than count on return
    if (from === value || motion.off || !ref.current || document.hidden) {
      shown.current = value;
      if (ref.current) ref.current.textContent = fmt.current(value);
      return;
    }
    const controls = animate(from, value, {
      duration: duration ?? (motion.full ? 0.9 : 0.3),
      ease: EASE,
      onUpdate: (v) => {
        shown.current = v;
        if (ref.current) ref.current.textContent = fmt.current(v);
      },
    });
    return () => {
      controls.stop();
      // interrupted (unmounted, or a newer value): never leave a half-counted figure
      shown.current = value;
    };
  }, [value, motion.off, motion.full, duration]);

  // React's text is the target; while a count is running, `onUpdate` has
  // already overwritten it with the frame in between, and it lands here
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {format(motion.off ? value : shown.current === value ? value : shown.current)}
    </span>
  );
}
