/**
 * These render whatever the state hands them, and the state is persisted
 * through JSON — where a NaN comes back as `null`. `null.toFixed(1)` threw,
 * React unmounted the tree, and the whole app went white because one
 * coordinator's salary was bad. A number that isn't a number renders as a
 * dash; it never takes the app down with it.
 */
const NO_VALUE = "—";

export function ordinal(n: number): string {
  if (!Number.isFinite(n) || n < 1) return NO_VALUE;
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}


/** whole-dollar number → "$12.4M" / "$780K". */
export function money(n: number): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/** value already in $M → "$12.4M". */
export function millions(n: number): string {
  return Number.isFinite(n) ? `$${n.toFixed(1)}M` : NO_VALUE;
}

export function seconds(total: number): string {
  if (!Number.isFinite(total)) return NO_VALUE;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function pct(n: number, digits = 0): string {
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : NO_VALUE;
}

/**
 * Tracker points — whole most of the time, a fraction when a point is split.
 *
 * Three GMs finishing level splits the placement point three ways, and the
 * score tracker rendered the result of that division: `11.333333333333334`
 * in the standings and `-0.6666666666666667` beside it. Two decimals, with
 * the zeros trimmed, so a whole number still reads as a whole number.
 */
export function points(n: number): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0$/, "");
}
