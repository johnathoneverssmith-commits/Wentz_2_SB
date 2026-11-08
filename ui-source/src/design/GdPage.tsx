import type { CSSProperties, ReactNode } from "react";
import { gdStyle } from "./teamArt";

/**
 * The page shell every gameday-designed screen sits in: the light page, this
 * team's colours as CSS variables, and the one-column grid the sections stack
 * in. Extra `data-*` attributes land on the shell (the decision rooms key CSS
 * on `data-team` / `data-focused`). `className` adds screen- or layout-specific hooks (`gd-tabbed` puts a
 * tab bar and its open panel in one ruled block).
 */
export function GdPage({
  code,
  className,
  children,
  ...data
}: { code: string | null | undefined; className?: string; children: ReactNode } & Record<`data-${string}`, string | boolean>) {
  return (
    <div className={"gd" + (className ? " " + className : "")} style={gdStyle(code ?? "") as CSSProperties} {...data}>
      <div className="gd-page">{children}</div>
    </div>
  );
}
