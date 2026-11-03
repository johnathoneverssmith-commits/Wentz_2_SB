import type { CSSProperties, ReactNode } from "react";
import { gdStyle } from "./teamArt";

/**
 * The page shell every gameday-designed screen sits in: the light page, this
 * team's colours as CSS variables, and the one-column grid the sections stack
 * in. `className` adds screen- or layout-specific hooks (`gd-tabbed` puts a
 * tab bar and its open panel in one ruled block).
 */
export function GdPage({ code, className, children }: { code: string | null | undefined; className?: string; children: ReactNode }) {
  return (
    <div className={"gd" + (className ? " " + className : "")} style={gdStyle(code ?? "") as CSSProperties}>
      <div className="gd-page">{children}</div>
    </div>
  );
}
