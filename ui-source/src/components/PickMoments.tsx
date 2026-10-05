import { useEffect, useRef, useState } from "react";

import { TEAMS_BY_CODE } from "@/data/teams";
import { type Moment, ScoreMoment } from "@/motion/ScoreMoment";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";

/**
 * A pick, as an event: the same moment a score gets, in the picking team's
 * colours.
 *
 * Your own picks get the full reveal; a first-round pick by anyone else gets
 * the brisk one; everything else is left alone, because a seven-round draft
 * has 224 picks and a fantasy draft has over a thousand and not all of them
 * can be an occasion. It only reacts to picks that land while it is mounted
 * (opening the room on a half-finished draft doesn't replay it), and it
 * sounds nothing: the "pick made" cue is already fired for your picks by
 * `useGameAudio`, and lands on the same beat.
 */
export function PickMoments() {
  const results = useStore((s) => s.draft?.results);
  const mode = useStore((s) => s.draft?.mode);
  const me = useStore((s) => viewerTeamCode(s));
  const [moment, setMoment] = useState<Moment | null>(null);
  const seen = useRef<number | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const n = results?.length ?? 0;
    if (seen.current === null || n < seen.current) {
      seen.current = n;
      return;
    }
    if (n === seen.current || !results) return;
    // several picks can land at once (the CPU's run after yours); the last is the one worth showing
    const pick = results[n - 1]!;
    seen.current = n;
    const mine = pick.teamCode === me;
    const firstRound = pick.round === 1;
    if (!mine && !(firstRound && mode === "rookie")) return;
    const meta = TEAMS_BY_CODE[pick.teamCode];
    setMoment({
      key: ++seq.current,
      color: meta?.color ?? "#444",
      label: pick.selectedName ?? "Pick is in",
      sub: `${meta?.abbr ?? pick.teamCode} · ${pick.selectedPosition ?? ""} · Round ${pick.round}, pick ${pick.pickNumber}`,
      from: "left",
      quiet: !mine,
    });
  }, [results, me, mode]);

  return <ScoreMoment moment={moment} onDone={() => setMoment(null)} />;
}
