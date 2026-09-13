/**
 * Keeps the suite hermetic.
 *
 * `HybridSimulationService` calls the engine adapter on localhost:8787 and
 * falls back to Mock when it can't reach it. That meant test results depended
 * on whether a dev server happened to be running: with one up, a full-suite
 * run hammered it from every worker at once, some calls timed out mid-league,
 * the circuit breaker tripped, and a league ended up half built from one pool
 * and half from the other — a franchise-year test that passed alone and
 * failed in the suite.
 *
 * The adapter has its own tests (`adapterFallback.test.ts` exercises this
 * seam deliberately); everything else runs on Mock, deterministically.
 */
import { beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("fetch disabled in tests"))),
  );
});
