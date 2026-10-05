import { m, type Variants } from "framer-motion";
import { Children, createContext, type ReactNode, useContext } from "react";

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
/**
 * Each child's place in its StaggerList. Rows past the first two dozen are
 * below the fold: they appear with no animation at all, so a 120-row market
 * costs 24 animations rather than 120.
 */
const RowIndex = createContext<number>(-1);
export const MAX_ANIMATED_ROWS = 24;
/** True for a row that should rise in: inside a StaggerList, and near the top. */
export function useRowRises(): boolean {
  const i = useContext(RowIndex);
  return i < 0 || i < MAX_ANIMATED_ROWS;
}

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
  // a 100-row market mustn't take three seconds to arrive: the whole
  // cascade is capped at about 0.6 s however many rows there are
  const per = Math.min(motion.stagger, 0.6 / Math.min(MAX_ANIMATED_ROWS, Math.max(1, Children.count(children))));
  const variants: Variants = { hidden: {}, show: { transition: { staggerChildren: per } } };
  return (
    <Tag className={className} variants={variants} initial="hidden" animate="show">
      {Children.map(children, (child, i) => (
        <RowIndex.Provider value={i}>{child}</RowIndex.Provider>
      ))}
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
  const rises = useRowRises();
  const Tag = m[as];
  if (!rises) return <Tag className={className}>{children}</Tag>;
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
