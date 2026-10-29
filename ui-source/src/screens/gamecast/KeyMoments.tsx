import { KIND_LABEL, type Highlight, highlightText } from "../../../../src/engine/highlights.js";

import "./highlights.css";

/**
 * The game's short list of big moments, as far as the replay has got.
 *
 * The list comes from the engine's highlight analysis (`src/engine/highlights.ts`),
 * which ranks moments by how much they moved the game. It only shows the ones the
 * viewer has already watched, for the same reason the drive chart does: a list
 * of every touchdown and turnover beside a replay would tell them the result.
 */
export function KeyMoments({
  moments,
  onJump,
}: {
  /** the revealed highlights, each with the replay position (`gi`) that shows its play. */
  moments: readonly { h: Highlight; gi: number }[];
  onJump: (gi: number) => void;
}): JSX.Element | null {
  if (moments.length === 0) return null;
  return (
    <div className="gc-hl-panel">
      <div className="gc-phead">
        <span>Key moments</span>
        <span className="n">{moments.length}</span>
      </div>
      <ul className="gc-hl-list">
        {moments.map(({ h, gi }) => (
          <li key={h.id}>
            <button type="button" className={`gc-hl-item ${h.tier ?? "notable"}`} onClick={() => onJump(gi)}>
              <span className="gc-hl-top">
                <span className={`gc-hl-badge ${h.tier ?? "notable"}`}>{KIND_LABEL[h.kind]}</span>
                <span className="gc-hl-when">
                  {h.quarter >= 5 ? "OT" : `Q${h.quarter}`}
                  {h.clock ? ` ${h.clock}` : ""}
                </span>
              </span>
              <span className="gc-hl-text">{highlightText(h)}</span>
              {h.context && <span className="gc-hl-why">{h.context}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small label on the live play when it is one of the game's key moments. */
export function HighlightBadge({ h }: { h: Highlight | undefined }): JSX.Element | null {
  if (!h) return null;
  return (
    <span className={`gc-hl-badge inline ${h.tier ?? "notable"}`} title={h.context}>
      {KIND_LABEL[h.kind]}
    </span>
  );
}
