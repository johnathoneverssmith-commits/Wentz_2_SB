import { describe, expect, it } from "vitest";

import { type SchemaDeps, applySchemaOnce } from "./schemaSetup.js";

/** Dependencies that record what was asked of them. */
function deps(over: Partial<SchemaDeps> = {}) {
  const calls = { loaded: 0, migrated: 0, ended: 0 };
  const load = async (): Promise<SchemaDeps> => {
    calls.loaded++;
    return {
      migrate: over.migrate ?? (async () => void calls.migrated++),
      end: over.end ?? (async () => void calls.ended++),
    };
  };
  return { calls, load };
}

describe("applying the schema once, before the workers", () => {
  it("does nothing, and loads nothing, with no database configured", async () => {
    const { calls, load } = deps();
    expect(await applySchemaOnce({}, load)).toEqual({ state: "skipped" });
    expect(calls).toEqual({ loaded: 0, migrated: 0, ended: 0 });
  });

  it("applies the schema exactly once and lets go of its connection", async () => {
    const { calls, load } = deps();
    let t = 100;
    const state = await applySchemaOnce({ DATABASE_URL: "postgres://u:p@h/db" }, load, () => (t += 7));
    expect(state).toEqual({ state: "applied", ms: 7 });
    expect(calls).toEqual({ loaded: 1, migrated: 1, ended: 1 });
  });

  it("counts a TEST_DATABASE_URL as a database, as the suites do", async () => {
    const { calls, load } = deps();
    const state = await applySchemaOnce({ TEST_DATABASE_URL: "postgres://u:p@h/db" }, load);
    expect(state.state).toBe("applied");
    expect(calls.migrated).toBe(1);
  });

  it("records a failure instead of throwing, so tests that need no database still run", async () => {
    const { calls, load } = deps({
      migrate: async () => {
        throw Object.assign(new Error("deadlock detected"), { name: "error", code: "40P01", routine: "DeadLockReport" });
      },
    });
    const state = await applySchemaOnce({ DATABASE_URL: "postgres://u:p@h/db" }, load);
    expect(state.state).toBe("failed");
    const failure = (state as { failure: string }).failure;
    expect(failure).toContain("[40P01]");
    expect(failure).toContain("deadlock detected");
    expect(calls.ended).toBe(1); // and still lets go of its connection
  });

  it("records a failure to even load the database module, and never prints a credential", async () => {
    const state = await applySchemaOnce(
      { DATABASE_URL: "postgres://ci_user:Zq7-fake-secret@h/db" },
      async () => {
        throw new Error("cannot connect to postgres://ci_user:Zq7-fake-secret@h/db");
      },
    );
    expect(state.state).toBe("failed");
    expect(JSON.stringify(state)).not.toContain("Zq7-fake-secret");
  });

  it("does not let a failure to close hide the result", async () => {
    const { load } = deps({
      end: async () => {
        throw new Error("already closed");
      },
    });
    expect((await applySchemaOnce({ DATABASE_URL: "postgres://u:p@h/db" }, load)).state).toBe("applied");
  });
});
