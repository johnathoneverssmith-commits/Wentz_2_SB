import type { KeyboardEvent } from "react";

import { onColorFor, TEAMS_BY_CODE } from "@/data/teams";

/**
 * Props that make a clickable div behave like a button for keyboard users:
 * focusable, announced as a button, and activated by Enter / Space.
 */
export function pressable(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

/** Rounded team-color chip with the 2–3 letter abbreviation. */
export function TeamBadge({ code, size = 30 }: { code: string; size?: number }) {
  const t = TEAMS_BY_CODE[code];
  if (!t) return null;
  return (
    <span
      className="oswald"
      style={{
        width: size,
        height: size,
        borderRadius: size <= 22 ? 6 : 8,
        background: t.color,
        // measured, not assumed: white on the Chargers' powder blue is 3.6:1
        color: onColorFor(t.color),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size <= 22 ? 9 : size <= 32 ? 10 : 13,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {t.abbr}
    </span>
  );
}

export function OvrPill({ value }: { value: number }) {
  const cls = value >= 85 ? "elite" : value >= 75 ? "mid" : "low";
  return <span className={`povr ${cls}`}>{value}</span>;
}
