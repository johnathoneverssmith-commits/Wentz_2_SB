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
  const sign = n < 0 ? "-" : ""; // "-$1.2M", like `millions`
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** value already in $M → "$12.4M". */
export function millions(n: number): string {
  if (!Number.isFinite(n)) return NO_VALUE;
  // "-$23.8M", not "$-23.8M" (and no "-$0.0M" for a rounding hair under zero)
  const r = Math.round(n * 10) / 10;
  return r < 0 ? `-$${(-r).toFixed(1)}M` : `$${Math.abs(r).toFixed(1)}M`;
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

/** A countdown, coarse: "2d 4h", "3h 10m", "25m". */
export function timeLeft(ms: number): string {
  if (ms < 60_000) return "under a minute";
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins % 60}m`;
  return `${mins}m`;
}

/**
 * "Ann", "Ann and Bo", "Ann, Bo and Cy". In a league of three or more GMs
 * "Waiting on Ann, Bo, Cy" read like a list someone forgot to finish.
 */
export function andList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "1 player", "3 players" — the count and its noun, agreeing. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** "4,931" — the way every other season of yardage in the game reads. */
export function commas(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : NO_VALUE;
}

/** "3–6 wks", or "1 wk" when the range is one number ("1–1 wks" read as a glitch). */
export function weeksOut(range: readonly [number, number] | readonly number[], long = false): string {
  const [a = 0, b = a] = range;
  const unit = (n: number) => (long ? (n === 1 ? "week" : "weeks") : n === 1 ? "wk" : "wks");
  return a === b ? `${a} ${unit(a)}` : `${a}–${b} ${unit(b)}`;
}

/**
 * How a position reads on screen. The data says ILB because the pool also has
 * two OLBs, but a league with no outside linebackers has no use for the
 * "I": it just reads as a typo, so the screens say LB.
 */
export function posLabel<T extends string | null | undefined>(position: T): T {
  return (position === "ILB" ? "LB" : position) as T;
}
