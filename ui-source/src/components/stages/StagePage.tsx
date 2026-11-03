import type { ReactNode } from "react";
import { GameDayMasthead } from "@/design/GameDayMasthead";
import { GdPage } from "@/design/GdPage";
import { SKYLINE_VIEWBOX, skylineSvg } from "@/design/teamArt";
import "@/design/gameday.css";
import "@/design/gameday-blocks.css";
import "@/screens/stages-gameday.css";

/**
 * The page every turn-event and setup stage sits in: the light gameday page,
 * a compact team masthead, then the stage's own sections.
 *
 * With no team (League Setup before a pick, a stale link) the masthead is the
 * neutral drawn skyline with no stadium photo, so nothing is requested that
 * does not exist.
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
  /** the small line above the big type: which stage this is */
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
      {code ? (
        <GameDayMasthead code={code} title={kicker} heading={heading} sub={sub} actions={actions} compact />
      ) : (
        <header className="gd-mast gd-mast--compact" data-photo="missing">
          <svg
            className="gd-mast-sky"
            viewBox={SKYLINE_VIEWBOX}
            preserveAspectRatio="xMaxYMax slice"
            aria-hidden="true"
            // generated from constants in teamArt.ts, never from user data
            dangerouslySetInnerHTML={{ __html: skylineSvg("") }}
          />
          <div className="gd-mast-tint" aria-hidden="true" />
          <div className="gd-mast-body">
            <h1>
              <span className="gd-kicker">{kicker}</span>
              <span className="sr-only">, </span>
              <span className="gd-team">{heading ?? ""}</span>
            </h1>
            <p className="gd-mast-sub">{sub}</p>
          </div>
          {actions && <div className="gd-mast-actions">{actions}</div>}
        </header>
      )}
      {children}
    </GdPage>
  );
}
