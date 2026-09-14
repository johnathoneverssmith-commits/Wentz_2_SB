/**
 * A brake on password guessing.
 *
 * The league server is a public URL with accounts on it, and `/auth/login`
 * was answerable as fast as the network allowed — scrypt makes each guess
 * cost the *server* something, but nothing stopped an attacker making
 * thousands of them against a name they had seen in a league.
 *
 * In memory on purpose. A shared counter in Postgres would be exact across
 * restarts and replicas, at the price of a write on every sign-in attempt,
 * and this runs as one process for a group of friends. A restart forgiving
 * the counter is an acceptable loss; the attack this stops is a sustained
 * one, and sustained attacks do not get a free restart.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

interface Bucket {
  count: number;
  /** When the window opened; the whole bucket resets after it passes. */
  since: number;
}

const buckets = new Map<string, Bucket>();

/** Stop unbounded growth from scattered single attempts. */
function sweepStale(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, b] of buckets) {
    if (now - b.since > WINDOW_MS) buckets.delete(key);
  }
}

/**
 * Records one attempt and says whether this key has run out of them.
 *
 * Keyed on whatever the caller considers the actor — here the client address
 * and the name being tried, together, so one person fumbling their own
 * password cannot lock out someone else's account by name alone.
 */
export function tooManyAttempts(key: string, now = Date.now()): boolean {
  sweepStale(now);
  const b = buckets.get(key);
  if (!b || now - b.since > WINDOW_MS) {
    buckets.set(key, { count: 1, since: now });
    return false;
  }
  b.count += 1;
  return b.count > MAX_ATTEMPTS;
}

/** A successful sign-in clears the slate for that key. */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}

/** Seconds until this key may try again, for the Retry-After header. */
export function retryAfterSeconds(key: string, now = Date.now()): number {
  const b = buckets.get(key);
  if (!b) return 0;
  return Math.max(1, Math.ceil((b.since + WINDOW_MS - now) / 1000));
}

/** Test seam: forget everything. */
export function resetThrottle(): void {
  buckets.clear();
}
