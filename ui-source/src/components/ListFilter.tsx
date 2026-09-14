import { type ReactNode, useMemo, useState } from "react";

/**
 * Finding one player in a list of hundreds.
 *
 * Every long list in the game used to be "sorted by overall, first N shown",
 * which works for the free agents a contender wants and fails completely for
 * the one a rebuilding team is actually looking for. A GM who needs a punter
 * on day four of free agency was, literally, unable to reach one: the punters
 * were all past the cutoff.
 *
 * So: type a name, or pick a position, and the cutoff applies to what's left
 * rather than to the whole market. The count says how many matched and how
 * many are being shown, because a silent truncation is the thing that made
 * the old lists untrustworthy.
 */
export interface Filterable {
  name: string;
  position: string;
}

export function useListFilter<T extends Filterable>(
  all: readonly T[],
  limit = 120,
): {
  /** What to render. */
  shown: T[];
  matched: number;
  total: number;
  /** The controls. Render above the list. */
  controls: ReactNode;
  query: string;
  position: string;
} {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState("ALL");

  const positions = useMemo(() => {
    const seen = new Set<string>();
    for (const item of all) seen.add(item.position);
    // "PICK" first when it's there — draft capital is what a trade is about
    return [...seen].sort((a, b) => (a === "PICK" ? -1 : b === "PICK" ? 1 : a.localeCompare(b)));
  }, [all]);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter(
      (item) =>
        (position === "ALL" || item.position === position) &&
        (needle === "" || item.name.toLowerCase().includes(needle)),
    );
  }, [all, query, position]);

  const controls = (
    <div className="listfilter">
      <input
        type="search"
        value={query}
        placeholder="Search by name"
        aria-label="Search by name"
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        value={position}
        aria-label="Filter by position"
        onChange={(e) => setPosition(e.target.value)}
      >
        <option value="ALL">All positions</option>
        {positions.map((p) => (
          <option key={p} value={p}>
            {p === "PICK" ? "Draft picks" : p}
          </option>
        ))}
      </select>
      <span className="count" role="status">
        {countLabel(matched.length, all.length, limit)}
      </span>
    </div>
  );

  return {
    shown: matched.slice(0, limit),
    matched: matched.length,
    total: all.length,
    controls,
    query,
    position,
  };
}

function countLabel(matched: number, total: number, limit: number): string {
  if (matched === 0) return "No matches";
  if (matched > limit) return `Showing ${limit} of ${matched}`;
  if (matched === total) return `${total} total`;
  return `${matched} of ${total}`;
}

/**
 * Column labels above a list of `ExpandableRow`s.
 *
 * Takes the same grid template the rows use, so the labels sit over the
 * columns they name. Pass an empty string for a column that speaks for itself
 * (the name, the action button) — a header on every column is noisier than
 * none at all. A label can carry its own alignment for the columns that are
 * right-aligned in the rows below, like money.
 */
export type ColumnLabel = string | { label: string; align: "left" | "center" | "right" };

export function RowHeader({
  gridTemplate,
  labels,
}: {
  gridTemplate: string;
  labels: ColumnLabel[];
}) {
  return (
    <div className="rowhead" style={{ gridTemplateColumns: gridTemplate }} aria-hidden="true">
      {labels.map((col, i) => {
        const label = typeof col === "string" ? col : col.label;
        const align = typeof col === "string" ? (i === 0 ? "left" : "center") : col.align;
        return (
          <span key={i} style={{ textAlign: align }}>
            {label}
          </span>
        );
      })}
    </div>
  );
}
