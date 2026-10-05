import { m, type Variants } from "framer-motion";
import type { ReactNode } from "react";

import { EASE, useMotion } from "./tokens";

/**
 * A list whose rows rise in one after another.
 *
 * Roster tables, standings and box scores used to appear all at once, which
 * reads as a page load. A short stagger (30 ms a row in full, 12 in subtle)
 * reads as the data arriving. Off renders plain elements. Rows past the
 * first few dozen simply ride in with the rest rather than stretching the
 * whole thing out.
 */
export function StaggerList({
  children,
  className,
  as = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "ul" | "ol";
}) {
  const motion = useMotion();
  if (motion.off) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }
  const Tag = m[as];
  const variants: Variants = { hidden: {}, show: { transition: { staggerChildren: motion.stagger } } };
  return (
    <Tag className={className} variants={variants} initial="hidden" animate="show">
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  as = "div",
  className,
}: {
  children: ReactNode;
  as?: "div" | "li";
  className?: string;
}) {
  const motion = useMotion();
  if (motion.off) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }
  const Tag = m[as];
  const variants: Variants = {
    hidden: { opacity: 0, y: motion.full ? 10 : 4 },
    show: { opacity: 1, y: 0, transition: { duration: motion.dur, ease: EASE } },
  };
  return (
    <Tag className={className} variants={variants}>
      {children}
    </Tag>
  );
}
