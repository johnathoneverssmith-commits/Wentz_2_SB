import { useState, type ReactNode } from "react";
import { TEAMS_BY_CODE } from "@/data/teams";
import { SKYLINE_VIEWBOX, skylineSvg, STADIUM_PHOTO_CREDITS, stadiumPhotoFocus, stadiumPhotoUrl } from "./teamArt";

/**
 * The team-coloured masthead: the screen's name, the team's name in big
 * type, and the team's stadium behind it.
 *
 * The drawn skyline is always there first; the photo replaces it only once it
 * has actually loaded, so a team with no photo (or a build opened without the
 * art folder) never shows a broken image or jumps.
 */
export function GameDayMasthead({ code, title, sub, actions }: {
  code: string;
  title: string;
  sub: ReactNode;
  actions?: ReactNode;
}) {
  // keyed on the code so a new team starts from the skyline again
  return <Masthead key={code} code={code} title={title} sub={sub} actions={actions} />;
}

function Masthead({ code, title, sub, actions }: { code: string; title: string; sub: ReactNode; actions?: ReactNode }) {
  const [photo, setPhoto] = useState<"loading" | "shown" | "missing">("loading");
  const meta = TEAMS_BY_CODE[code];
  const credit = STADIUM_PHOTO_CREDITS[code];
  return (
    <header className="gd-mast" data-team={code} data-photo={photo}>
      <svg
        className="gd-mast-sky"
        viewBox={SKYLINE_VIEWBOX}
        preserveAspectRatio="xMaxYMax slice"
        aria-hidden="true"
        // generated from constants in teamArt.ts, never from user data
        dangerouslySetInnerHTML={{ __html: skylineSvg(code) }}
      />
      {photo !== "missing" && (
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
        <h1>
          <span className="gd-kicker">{title}</span>
          <span className="sr-only">, </span>
          <span className="gd-team">
            <span>{meta?.city ?? code}</span> <span>{meta?.name ?? ""}</span>
          </span>
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
