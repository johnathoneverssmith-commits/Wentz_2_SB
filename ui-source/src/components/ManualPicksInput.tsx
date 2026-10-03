import { useEffect, useState } from "react";

import { ROSTER_SIZE } from "@/sim/roster-template";

/** The most picks a GM can make by hand: every roster spot. */
export const MAX_MANUAL_PICKS = ROSTER_SIZE;

/** What was typed, as a pick count the draft can use — or null while it isn't one. */
export function manualPicksFrom(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 1 && n <= MAX_MANUAL_PICKS ? n : null;
}

/**
 * "Manual picks each", typed rather than chosen: any number from 1 to a whole
 * roster. A box that is empty or half-typed reports nothing; leaving it puts
 * back the last good number rather than an invalid one.
 */
export function ManualPicksInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  // follow the setting when something else changes it
  useEffect(() => {
    if (manualPicksFrom(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={`Manual picks each, 1 to ${MAX_MANUAL_PICKS}`}
      value={text}
      disabled={disabled}
      maxLength={2}
      style={{ width: 72 }}
      onChange={(e) => {
        const next = e.target.value.replace(/[^\d]/g, "");
        setText(next);
        const n = manualPicksFrom(next);
        if (n !== null) onChange(n);
      }}
      onBlur={() => setText(String(manualPicksFrom(text) ?? value))}
    />
  );
}
