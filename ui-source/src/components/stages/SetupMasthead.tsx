import { useState, type ReactNode } from "react";
import {
  SKYLINE_VIEWBOX,
  skylineSvg,
  STADIUM_PHOTO_CREDITS,
  stadiumPhotoFocus,
  stadiumPhotoUrl,
} from "@/design/teamArt";

/**
 * League Setup's masthead. It is the shared masthead's look, with the two
 * headings this screen has always had: "League Setup" (the screen) and the
 * game's title, "The Seahawks' Road to the Super Bowl" once a team is picked,
 * as the big type. With no team yet it is the neutral drawn skyline and asks
 * for one; it requests no stadium photo.
 */
export function SetupMasthead({
  code,
  title,
  headline,
  announce,
  sub,
  actions,
}: {
  code: string | null | undefined;
  title: string;
  /** the big type: the game's title, with the team in it once one is picked */
  headline: string;
  /** said to a screen reader when a team is picked */
  announce?: string;
  sub: ReactNode;
  actions?: ReactNode;
}) {
  // keyed on the code so a new pick starts from the skyline again
  return <Inner key={code ?? "none"} code={code} title={title} headline={headline} announce={announce} sub={sub} actions={actions} />;
}

function Inner({
  code,
  title,
  headline,
  announce,
  sub,
  actions,
}: {
  code: string | null | undefined;
  title: string;
  headline: string;
  announce?: string;
  sub: ReactNode;
  actions?: ReactNode;
}) {
  const [photo, setPhoto] = useState<"loading" | "shown" | "missing">(code ? "loading" : "missing");
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
        {/* the visible title changes when a team is chosen; this says so to a screen reader */}
        <p className="sr-only" role="status">
          {announce ?? ""}
        </p>
        <h1 className="gd-team" aria-label={headline}>
          {headline}
        </h1>
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
