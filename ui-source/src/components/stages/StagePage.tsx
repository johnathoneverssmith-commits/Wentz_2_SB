import type { ReactNode } from "react";
import { GdPage } from "@/design/GdPage";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "@/screens/stages-gameday.css";
import { StageMasthead } from "./SetupMasthead";

/**
 * The page every turn-event and setup stage sits in: the light gameday page,
 * a compact team masthead, then the stage's own sections.
 *
 * `kicker` is the stage's name and the page's h1 (see StageMasthead). With no
 * team (a stale link) the masthead is the neutral drawn skyline.
 */
export function StagePage({
  code,
  kicker,
  heading,
  sub,
  actions,
  className,
  children,
}: {
  code: string | null | undefined;
  /** the stage's name: the page's h1 */
  kicker: string;
  /** the big type; omitted, the team's own name */
  heading?: ReactNode;
  sub: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <GdPage code={code} className={"gd-stage" + (className ? " " + className : "")}>
      <StageMasthead code={code} title={kicker} bigType={heading} sub={sub} actions={actions} />
      {children}
    </GdPage>
  );
}
