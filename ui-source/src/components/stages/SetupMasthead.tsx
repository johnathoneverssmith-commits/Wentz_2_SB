import { useState, type ReactNode } from "react";
import { TEAMS_BY_CODE } from "@/data/teams";
import {
  SKYLINE_VIEWBOX,
  skylineSvg,
  STADIUM_PHOTO_CREDITS,
  stadiumPhotoFocus,
  stadiumPhotoUrl,
} from "@/design/teamArt";

/**
 * The masthead for the setup and turn-event stages. It is the shared
 * masthead's look, but the page's h1 is exactly the stage's own name ("Coaching
 * Draft Summary", "Waiting for other players"): that is the heading people,
 * and the browser suite, look for, so the team's name under it is plain big
 * type and not part of the heading.
 *
 * League Setup also has its game title as a second h1 (`headline`): "The
 * Seahawks' Road to the Super Bowl" once a team is picked, with `announce`
 * said to a screen reader when it changes.
 *
 * With no team the masthead is the neutral drawn skyline and requests no
 * stadium photo.
 */
export interface StageMastheadProps {
  code: string | null | undefined;
  title: string;
  /** the big type when there is no `headline`: omitted, the team's own name */
  bigType?: ReactNode;
  headline?: string;
  announce?: string;
  sub: ReactNode;
  actions?: ReactNode;
}

export function StageMasthead(props: StageMastheadProps) {
  // keyed on the code so a new pick starts from the skyline again
  return <Inner key={props.code ?? "none"} {...props} />;
}

/** League Setup's name for the same thing */
export const SetupMasthead = StageMasthead;

function Inner({ code, title, bigType, headline, announce, sub, actions }: StageMastheadProps) {
  const [photo, setPhoto] = useState<"loading" | "shown" | "missing">(code ? "loading" : "missing");
  const meta = code ? TEAMS_BY_CODE[code] : undefined;
  const credit = code ? STADIUM_PHOTO_CREDITS[code] : undefined;
  return (
    <header className="gd-mast gd-mast--compact" data-team={code ?? ""} data-photo={photo}>
      <svg
        className="gd-mast-sky"
        viewBox={SKYLINE_VIEWBOX}
        preserveAspectRatio="xMaxYMax slice"
        aria-hidden="true"
        // generated from constants in teamArt.ts, never from user data
        dangerouslySetInnerHTML={{ __html: skylineSvg(code ?? "") }}
      />
      {code && photo !== "missing" && (
        <img
          className="gd-mast-photo"
          src={stadiumPhotoUrl(code)}
          alt=""
          decoding="async"
          style={{ objectPosition: stadiumPhotoFocus(code) }}
          onLoad={() => setPhoto("shown")}
          onError={() => setPhoto("missing")}
        />
      )}
      <div className="gd-mast-tint" aria-hidden="true" />
      <div className="gd-mast-body">
        <h1 className="gd-kicker">{title}</h1>
        {headline !== undefined ? (
          <>
            {/* the visible title changes when a team is chosen; this says so to a screen reader */}
            <p className="sr-only" role="status">
              {announce ?? ""}
            </p>
            <h1 className="gd-team" aria-label={headline}>
              {headline}
            </h1>
          </>
        ) : (
          <p className="gd-team">
            {bigType ??
              (meta ? (
                <>
                  <span>{meta.city}</span> <span>{meta.name}</span>
                </>
              ) : (
                ""
              ))}
          </p>
        )}
        <p className="gd-mast-sub">{sub}</p>
      </div>
      {actions && <div className="gd-mast-actions">{actions}</div>}
      {photo === "shown" && credit && (
        <p className="gd-credit">
          Photo:{" "}
          <a href={credit.source} target="_blank" rel="noreferrer">
            {credit.title}
          </a>
          , {credit.author}, {credit.license}, via Wikimedia Commons
        </p>
      )}
    </header>
  );
}
