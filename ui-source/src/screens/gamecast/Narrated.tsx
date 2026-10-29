import type { PlayNarration, Seg } from "../../../../src/engine/narration.js";

/**
 * A narrated play, with the player names picked out.
 *
 * The words come from the engine's shared narration (`src/engine/narration.ts`),
 * the same function that writes the stored `desc`, so what is shown here and
 * what a replay or the online server produces cannot drift apart. A name is a
 * segment of its own so it can be styled; everything else is plain text. Lines
 * for a flag, a spike or a kneel since the previous snap come first.
 */
export function Narrated({ n }: { n: PlayNarration }): JSX.Element {
  const render = (segs: readonly Seg[]): JSX.Element[] =>
    segs.map((s, i) => (typeof s === "string" ? <span key={i}>{s}</span> : <span key={i} className="gc-name">{s.name}</span>));
  return (
    <>
      {n.before.map((line, i) => (
        <span key={i} className="gc-flag">
          {render(line)}
          {". "}
        </span>
      ))}
      {render(n.play)}
    </>
  );
}
