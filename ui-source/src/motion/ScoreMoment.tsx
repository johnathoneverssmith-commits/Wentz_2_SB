import { m } from "framer-motion";
import { useEffect, useMemo } from "react";

import { EASE, EASE_IMPACT, useMotion } from "./tokens";

/**
 * A score, as an event.
 *
 * Every score gets one, whichever team it is: the scoring team's own colours
 * sweep across, so a glance says who just scored before the words do, and the
 * other team's touchdown looks as big as yours in *their* colours. In full it
 * is the broadcast package (a banner that sweeps in and hangs, the label
 * landing with a little overshoot, a burst of confetti in the team's colours);
 * in subtle a brisk coloured band and label, no confetti; with motion off
 * nothing renders and the score simply changes.
 *
 * It never blocks: the overlay ignores the pointer, plays out on its own and
 * tells its owner when it is done, so a replay running at speed can fire the
 * next one over the top of it.
 */
export interface Moment {
  /** changes for each new moment, so the same score twice replays */
  key: string | number;
  /** the scoring team's colour */
  color: string;
  /** "TOUCHDOWN" */
  label: string;
  /** "BUF · 14–7" */
  sub?: string;
  /** which edge the banner enters from: the away side from the left, home from the right */
  from?: "left" | "right";
  /** play the brisk version even in full motion: for moments that are frequent */
  quiet?: boolean;
}

/** A small deterministic generator so a moment looks the same each time it replays. */
function rng(seed: string | number): () => number {
  let a = 2166136261;
  for (const ch of String(seed)) a = Math.imul(a ^ ch.charCodeAt(0), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ScoreMoment({ moment, onDone }: { moment: Moment | null; onDone?: () => void }) {
  const motion = useMotion();
  const full = motion.full && !moment?.quiet;
  const total = full ? 1.9 : 0.8;

  useEffect(() => {
    if (!moment || motion.off) return;
    const id = setTimeout(() => onDone?.(), total * 1000);
    return () => clearTimeout(id);
  }, [moment, motion.off, total, onDone]);

  const bits = useMemo(() => {
    if (!moment || !full) return [];
    const r = rng(moment.key);
    return Array.from({ length: 30 }, (_, i) => {
      const angle = r() * Math.PI * 2;
      const dist = 90 + r() * 170;
      return {
        i,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist * 0.7 + 50,
        size: 4 + r() * 5,
        rot: (r() - 0.5) * 540,
        delay: r() * 0.12,
        tone: i % 3 === 0 ? "#ffffff" : i % 3 === 1 ? moment.color : `color-mix(in srgb, ${moment.color} 55%, white)`,
      };
    });
  }, [moment, full]);

  if (!moment || motion.off) return null;
  const dir = moment.from === "right" ? 1 : -1;

  return (
    <div className="score-moment" aria-hidden="true" key={moment.key}>
      <m.div
        className="sm-band"
        style={{
          background: moment.color,
          // a light edge and a coloured glow: a navy or black team colour
          // would otherwise disappear into the dark interface
          boxShadow: `0 0 0 2px rgba(255,255,255,0.4), 0 10px 44px color-mix(in srgb, ${moment.color} 70%, transparent)`,
        }}
        initial={{ x: `${dir * -110}%`, opacity: 1 }}
        animate={
          full
            ? { x: ["" + dir * -110 + "%", "0%", "0%", `${dir * 110}%`], opacity: 1 }
            : { x: ["0%", "0%"], opacity: [0, 0.9, 0] }
        }
        transition={
          full
            ? { duration: total, times: [0, 0.22, 0.72, 1], ease: EASE }
            : { duration: total, times: [0, 0.3, 1], ease: EASE }
        }
      />
      <m.div
        className="sm-label"
        initial={{ opacity: 0, scale: full ? 2.4 : 1, letterSpacing: full ? "0.5em" : "0.12em" }}
        animate={
          full
            ? { opacity: [0, 1, 1, 0], scale: [2.4, 1, 1, 1], letterSpacing: ["0.5em", "0.12em", "0.12em", "0.12em"] }
            : { opacity: [0, 1, 1, 0], scale: 1 }
        }
        transition={{ duration: total, times: full ? [0.05, 0.3, 0.78, 1] : [0, 0.2, 0.7, 1], ease: full ? EASE_IMPACT : EASE }}
      >
        <span>{moment.label}</span>
        {moment.sub && <small>{moment.sub}</small>}
      </m.div>
      {bits.map((b) => (
        <m.span
          key={b.i}
          className="sm-bit"
          style={{ width: b.size, height: b.size * 0.6, background: b.tone }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.4 }}
          animate={{ x: b.x, y: b.y, opacity: [0, 1, 1, 0], rotate: b.rot, scale: 1 }}
          transition={{ duration: 1.25, delay: 0.3 + b.delay, ease: [0.1, 0.7, 0.3, 1], times: [0, 0.1, 0.65, 1] }}
        />
      ))}
    </div>
  );
}
