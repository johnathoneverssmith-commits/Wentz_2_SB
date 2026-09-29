import { POSITION_GROUPS, POSITION_MINIMUMS, POSITION_TO_GROUP } from "@/domain";
import type { Player, PositionGroup } from "@/domain";

/**
 * The shared "Team Needs" view: numerator = players on the roster at a position
 * group, denominator = the minimum. Green when the minimum is met, red when short.
 */
export function RosterNeeds({ roster }: { roster: Player[] }) {
  const counts = new Map<PositionGroup, number>();
  // the best player in each group too: "3 / 2" read as covered with three
  // backups and no starter worth the name
  const best = new Map<PositionGroup, number>();
  for (const p of roster) {
    const g = POSITION_TO_GROUP[p.position];
    counts.set(g, (counts.get(g) ?? 0) + 1);
    best.set(g, Math.max(best.get(g) ?? 0, p.overall));
  }
  return (
    <>
      {/* "3 / 2" is unreadable without this: the second number is the floor,
          not a target, and green means you're above it. */}
      <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-faint)" }}>
        On the roster / the minimum a legal lineup needs, and the best player in the group.
      </p>
      <div className="needgrid">
      {POSITION_GROUPS.map((g) => {
        const have = counts.get(g) ?? 0;
        const min = POSITION_MINIMUMS[g] ?? 1;
        const filled = have >= min;
        const top = best.get(g) ?? 0;
        return (
          <div key={g} className={`needcell ${filled ? "filled" : "short"}`}>
            <div className="pos">{g}</div>
            <div className="count">
              {have}
              <span style={{ fontSize: 12, color: "var(--ink-faint)" }}> / {min}</span>
            </div>
            {have > 0 && (
              <div style={{ fontSize: 10.5, color: top < 72 ? "var(--notice)" : "var(--ink-faint)" }}>
                best {top}
                {top < 72 ? " · weak" : ""}
              </div>
            )}
          </div>
        );
      })}
      </div>
    </>
  );
}
