import { POSITION_GROUPS, POSITION_MINIMUMS, POSITION_TO_GROUP } from "@/domain";
import type { Player, PositionGroup } from "@/domain";

/**
 * The shared "Team Needs" view: numerator = players on the roster at a position
 * group, denominator = the minimum. Green when the minimum is met, red when short.
 */
export function RosterNeeds({ roster }: { roster: Player[] }) {
  const counts = new Map<PositionGroup, number>();
  for (const p of roster) {
    const g = POSITION_TO_GROUP[p.position];
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return (
    <>
      {/* "3 / 2" is unreadable without this: the second number is the floor,
          not a target, and green means you're above it. */}
      <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-faint)" }}>
        On the roster / the minimum a legal lineup needs.
      </p>
      <div className="needgrid">
      {POSITION_GROUPS.map((g) => {
        const have = counts.get(g) ?? 0;
        const min = POSITION_MINIMUMS[g] ?? 1;
        const filled = have >= min;
        return (
          <div key={g} className={`needcell ${filled ? "filled" : "short"}`}>
            <div className="pos">{g}</div>
            <div className="count">
              {have}
              <span style={{ fontSize: 12, color: "var(--ink-faint)" }}> / {min}</span>
            </div>
          </div>
        );
      })}
      </div>
    </>
  );
}
