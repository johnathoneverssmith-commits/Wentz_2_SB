import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as sel from "../.claude/skills/wentz-verify/select-checks.mjs";
import type { Change, Context, IndexedTest, Plan, RawChange, Source } from "../.claude/skills/wentz-verify/select-checks.mjs";

/**
 * The verification selector decides which checks a change needs. A mistake
 * here is silent in the worst way: too little and a regression is called
 * verified, so these tests pin the cases that matter (renames, deletions,
 * paths nobody wrote a rule for, changes that span subsystems, and changes that
 * are not committed yet) and keep the risk map from drifting away from the repo.
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = join(ROOT, ".claude/skills/wentz-verify/select-checks.mjs");
const map = sel.loadMap();
const realIndex = sel.buildTestIndex(ROOT, map);

const change = (path: string, status = "M", sources: Source[] = ["committed"], extra: Partial<Change> = {}): Change => ({
  path,
  status,
  sources,
  ...extra,
});
const ctx: Context = { base: "origin/master", mergeBase: "abc1234def" };
const run = (changes: Change[], testIndex: IndexedTest[] = realIndex, context: Context = ctx): Plan =>
  sel.plan({ changes, testIndex, map, context });
const ids = (p: Plan, which: "required" | "recommended" = "required") => p[which].map((c) => c.id);
const allIds = (p: Plan) => [...ids(p), ...ids(p, "recommended")];
const test_ = (path: string, imports: string[], project = "engine"): IndexedTest => ({ path, project, projectRoot: ".", imports });

describe("globs", () => {
  it("keeps * inside a segment and lets ** cross them", () => {
    expect(sel.globToRegExp("a/*.ts").test("a/b.ts")).toBe(true);
    expect(sel.globToRegExp("a/*.ts").test("a/b/c.ts")).toBe(false);
    expect(sel.globToRegExp("a/**/b.ts").test("a/b.ts")).toBe(true);
    expect(sel.globToRegExp("a/**/b.ts").test("a/x/y/b.ts")).toBe(true);
    expect(sel.globToRegExp("a/**").test("a/x/y.ts")).toBe(true);
    expect(sel.globToRegExp("a/**/b.ts").test("a/b.tsx")).toBe(false);
  });

  it("treats dots literally and expands braces", () => {
    expect(sel.globToRegExp("x.json").test("xajson")).toBe(false);
    expect(sel.expandBraces("a/{b,c}/d.ts")).toEqual(["a/b/d.ts", "a/c/d.ts"]);
    expect(sel.matchesAny("online/src/db.ts", ["online/src/{db,migrate}.ts"])).toBe(true);
    expect(sel.matchesAny("online/src/index.ts", ["online/src/{db,migrate}.ts"])).toBe(false);
  });

  it("matches dot-directories", () => {
    expect(sel.matchesAny(".github/workflows/deploy-render.yml", [".github/**"])).toBe(true);
  });
});

describe("reading git's name-status output", () => {
  it("reads modifications, additions, deletions, renames, copies and type changes", () => {
    const out = sel.parseNameStatus("M\ta.ts\nA\tb.ts\nD\tc.ts\nR100\told.ts\tnew.ts\nC75\tsrc.ts\tcopy.ts\nT\td.ts\n", "committed");
    expect(out).toEqual([
      { path: "a.ts", status: "M", source: "committed" },
      { path: "b.ts", status: "A", source: "committed" },
      { path: "c.ts", status: "D", source: "committed" },
      { path: "new.ts", oldPath: "old.ts", status: "R", source: "committed" },
      { path: "copy.ts", oldPath: "src.ts", status: "C", source: "committed" },
      { path: "d.ts", status: "M", source: "committed" },
    ]);
  });

  it("tolerates CRLF, blank lines and backslashes", () => {
    expect(sel.parseNameStatus("M\tdir\\a.ts\r\n\r\n", "staged")).toEqual([{ path: "dir/a.ts", status: "M", source: "staged" }]);
    expect(sel.parseUntracked("x/y.ts\r\n\r\nz.md\n").map((e) => e.path)).toEqual(["x/y.ts", "z.md"]);
  });
});

describe("folding committed, staged, unstaged and untracked changes into one set", () => {
  const e = (path: string, status: string, source: Source, oldPath?: string): RawChange => ({ path, status, source, ...(oldPath ? { oldPath } : {}) });

  it("keeps every source a file appears in, in the order they happened", () => {
    const merged = sel.mergeChanges([e("a.ts", "M", "unstaged"), e("a.ts", "M", "committed"), e("a.ts", "M", "staged")]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.sources).toEqual(["committed", "staged", "unstaged"]);
  });

  it("includes a file nobody has added to git yet", () => {
    const merged = sel.mergeChanges([e("online/src/new.ts", "A", "untracked")]);
    expect(merged).toEqual([{ path: "online/src/new.ts", status: "A", sources: ["untracked"] }]);
  });

  it("lets the file as it is now win: committed, then deleted in the working tree, is a deletion", () => {
    const merged = sel.mergeChanges([e("a.ts", "M", "committed"), e("a.ts", "D", "unstaged")]);
    expect(merged[0]?.status).toBe("D");
  });

  it("drops a file that was added on the branch and removed again (the base never had it)", () => {
    expect(sel.mergeChanges([e("tmp.ts", "A", "committed"), e("tmp.ts", "D", "unstaged")])).toEqual([]);
  });

  it("brings a file back as a modification when it was deleted and re-added", () => {
    const merged = sel.mergeChanges([e("a.ts", "D", "committed"), e("a.ts", "A", "untracked")]);
    expect(merged[0]?.status).toBe("M");
  });

  it("records a rename at both paths", () => {
    const merged = sel.mergeChanges([e("new/b.ts", "R", "committed", "old/a.ts")]);
    const byPath = Object.fromEntries(merged.map((c) => [c.path, c]));
    expect(byPath["old/a.ts"]).toMatchObject({ status: "D", renamedTo: "new/b.ts" });
    expect(byPath["new/b.ts"]).toMatchObject({ status: "R", oldPath: "old/a.ts" });
  });

  it("is independent of the order entries arrive in", () => {
    const entries = [e("a.ts", "M", "committed"), e("b.ts", "A", "staged"), e("c.ts", "M", "unstaged"), e("d.ts", "A", "untracked")];
    expect(sel.mergeChanges([...entries].reverse())).toEqual(sel.mergeChanges(entries));
  });
});

describe("collecting changes from a real git repository", () => {
  // About 20 real git processes: 1.7 s alone, but over 30 s when two full engine suites share the CPU
  // (measured, see the PR). A real git repository is the point of the test, so it keeps its repository
  // and gets the time it needs on a loaded machine.
  it("sees committed, staged, unstaged, untracked, renamed and deleted files", { timeout: 120_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-sel-"));
    try {
      const sh = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" });
      const put = (rel: string, text: string) => {
        mkdirSync(dirname(join(dir, rel)), { recursive: true });
        writeFileSync(join(dir, rel), text);
      };
      const body = (name: string) => Array.from({ length: 30 }, (_, i) => `// ${name} line ${i}`).join("\n") + "\n";
      sh("-c", "init.defaultBranch=master", "init", "-q");
      sh("config", "user.email", "t@example.com");
      sh("config", "user.name", "t");
      sh("config", "core.autocrlf", "false");
      for (const f of ["src/engine/a.ts", "online/src/b.ts", "docs/x.md", "ui-source/src/state/c.ts"]) put(f, body(f));
      sh("add", "-A");
      sh("commit", "-q", "-m", "base");
      sh("switch", "-q", "-c", "work");

      put("src/engine/a.ts", body("src/engine/a.ts") + "// changed\n"); // committed modification
      sh("mv", "online/src/b.ts", "online/src/b2.ts"); // committed rename
      sh("add", "-A");
      sh("commit", "-q", "-m", "work");

      put("ui-source/src/state/d.ts", body("d")); // staged addition
      sh("add", "ui-source/src/state/d.ts");
      put("docs/x.md", body("docs/x.md") + "more\n"); // unstaged modification
      rmSync(join(dir, "ui-source/src/state/c.ts")); // unstaged deletion
      put("ui-source/src/state/new.ts", body("new")); // untracked
      put("online/test/_probe.test.ts", body("probe")); // untracked scratch

      const got = sel.collectChanges({ cwd: dir, base: "master" });
      expect(got.baseMissing).toBe(false);
      const by = Object.fromEntries(got.changes.map((c) => [c.path, c]));
      expect(by["src/engine/a.ts"]).toMatchObject({ status: "M", sources: ["committed"] });
      expect(by["online/src/b.ts"]).toMatchObject({ status: "D", renamedTo: "online/src/b2.ts" });
      expect(by["online/src/b2.ts"]).toMatchObject({ status: "R", oldPath: "online/src/b.ts" });
      expect(by["ui-source/src/state/d.ts"]).toMatchObject({ status: "A", sources: ["staged"] });
      expect(by["docs/x.md"]).toMatchObject({ status: "M", sources: ["unstaged"] });
      expect(by["ui-source/src/state/c.ts"]).toMatchObject({ status: "D", sources: ["unstaged"] });
      expect(by["ui-source/src/state/new.ts"]).toMatchObject({ status: "A", sources: ["untracked"] });
      expect(by["online/test/_probe.test.ts"]?.sources).toEqual(["untracked"]);

      const without = sel.collectChanges({ cwd: dir, base: "master", includeUntracked: false });
      expect(without.changes.some((c) => c.path === "ui-source/src/state/new.ts")).toBe(false);

      const missing = sel.collectChanges({ cwd: dir, base: "no-such-branch" });
      expect(missing.baseMissing).toBe(true);
      expect(missing.warnings.join(" ")).toMatch(/no-such-branch/);
      // an uncommitted change is still seen when the base is missing
      expect(missing.changes.some((c) => c.path === "docs/x.md")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("classifying paths", () => {
  const cases: [string, string][] = [
    ["src/engine/sim.ts", "engine"],
    ["src/schema/player.ts", "engine-support"],
    ["src/index.ts", "engine-support"],
    ["server/index.ts", "engine-adapter"],
    ["analysis/39_league_metrics.ts", "analysis-scripts"],
    ["artifacts/models/portable/x.json", "engine-data"],
    ["data/players_sample.json", "engine-data"],
    ["ui-source/src/data/pool-2026.json", "engine-data"],
    ["test/engine-realism.test.ts", "tests-only"],
    ["test/fixtures/pool.json", "tests-only"],
    ["online/src/db.ts", "database"],
    ["online/schema.sql", "database"],
    ["online/src/migrate.ts", "database"],
    ["online/src/index.ts", "online-http-and-visibility"],
    ["online/src/stream.ts", "online-http-and-visibility"],
    ["online/src/phases.ts", "online-stage-wiring"],
    ["online/src/decide.ts", "online-stage-wiring"],
    ["online/src/leagues.ts", "online-stage-wiring"],
    ["online/src/throttle.ts", "online-http-and-visibility"],
    ["online/src/somethingNew.ts", "online-server"],
    ["online/dev/local-db.ts", "online-dev-tooling"],
    ["online/test/lobby.test.ts", "tests-only"],
    ["online/test/requireDatabase.ts", "test-infrastructure"],
    ["online/test/globalSetup.ts", "test-infrastructure"],
    ["online/test/passing-volume.test.ts", "statistical-tests"],
    ["ui-source/src/state/stageMachine.ts", "franchise-stage-rules"],
    ["ui-source/src/state/reveal.ts", "franchise-stage-rules"],
    ["ui-source/src/state/contracts.ts", "franchise-rules"],
    ["ui-source/src/sim/MockSimulationService.ts", "franchise-rules"],
    ["ui-source/src/domain/bracket.ts", "franchise-rules"],
    ["ui-source/src/state/howItWorks.ts", "how-it-works"],
    ["ui-source/src/state/reveal.test.ts", "tests-only"],
    ["ui-source/src/state/__soak.test.ts", "tests-only"],
    ["ui-source/src/components/positionGroups.test.ts", "tests-only"],
    ["ui-source/src/components/DraftRoom.tsx", "ui-presentation"],
    ["ui-source/src/screens/PostseasonBracket.tsx", "ui-presentation"],
    ["ui-source/src/util/format.ts", "ui-other"],
    [".github/workflows/deploy-render.yml", "ci-or-deploy-config"],
    ["scripts/verify-deployment.mjs", "ci-or-deploy-config"],
    ["package.json", "dependencies"],
    ["ui-source/package-lock.json", "dependencies"],
    ["tsconfig.json", "build-or-test-config"],
    ["online/vitest.config.ts", "online-test-config"],
    ["online/tsconfig.json", "online-test-config"],
    ["vitest.config.ts", "engine-test-config"],
    ["ui-source/vite.config.ts", "ui-build-config"],
    ["ui-source/tsconfig.app.json", "ui-build-config"],
    ["CLAUDE.md", "docs"],
    ["docs/decisions.md", "docs"],
    ["ui-source/README.md", "docs"],
    [".claude/skills/wentz-verify/SKILL.md", "verification-tooling"],
    [".claude/launch.json", "claude-config"],
    [".gitignore", "repo-meta"],
  ];
  it.each(cases)("%s -> %s", (path, cls) => {
    const c = sel.classify(path, map);
    expect(c.kind, path).toBe("rule");
    expect("rule" in c ? c.rule.class : "", path).toBe(cls);
  });

  it("does not take tracked double-underscore files for scratch", () => {
    expect(sel.looksLikeScratch("ui-source/src/state/__soak.test.ts", map)).toBe(false);
    expect(sel.looksLikeScratch("analysis/engine/__init__.py", map)).toBe(false);
    expect(sel.looksLikeScratch("online/test/_tafi.test.ts", map)).toBe(true);
    expect(sel.looksLikeScratch("online/tafi_slow.tsv", map)).toBe(true);
  });
});

describe("a path nobody wrote a rule for is never silently ignored", () => {
  it("asks for everything CI runs when a source file is unknown", () => {
    const p = run([change("tools/new-thing.ts", "A", ["untracked"])]);
    expect(p.unknownSourcePaths).toEqual(["tools/new-thing.ts"]);
    expect(p.conservative).toBe(true);
    expect(p.risk).toBe("conservative");
    for (const id of map.unknown.conservative) expect(ids(p), id).toContain(id);
    expect(p.notes.join(" ")).toContain("tools/new-thing.ts");
  });

  it("treats a new directory inside a known project the same way", () => {
    expect(run([change("online/newarea/x.ts", "A", ["staged"])]).conservative).toBe(true);
    expect(run([change("ui-source/eslint.config.js", "A", ["untracked"])]).conservative).toBe(true);
    expect(run([change("tool.py", "A", ["untracked"])]).conservative).toBe(true);
    expect(run([change("infra/main.yml", "A", ["committed"])]).conservative).toBe(true);
  });

  it("is not diluted by sitting among files that are known", () => {
    const p = run([change("docs/a.md"), change("tools/new-thing.ts", "A", ["untracked"])]);
    expect(p.conservative).toBe(true);
    expect(ids(p)).toContain("full-engine");
  });

  it("lists a non-source unknown file, with no checks, so it is visible", () => {
    const p = run([change("weird/notes.txt", "A", ["untracked"])]);
    expect(p.unclassifiedPaths).toEqual(["weird/notes.txt"]);
    expect(p.conservative).toBe(false);
    expect(ids(p)).toEqual(["scope"]);
    expect(sel.renderText(p)).toContain("weird/notes.txt");
  });

  it("asks for everything when the base to compare with is missing", () => {
    const p = run([change("docs/a.md")], realIndex, { base: "origin/master", baseMissing: true, warnings: ["could not find a common ancestor"] });
    expect(p.conservative).toBe(true);
    expect(ids(p)).toContain("full-online");
    expect(p.warnings.join(" ")).toContain("common ancestor");
  });

  it("covers every source file tracked in this repository", () => {
    const tracked = execFileSync("git", ["-c", "core.quotepath=false", "ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split("\n")
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(100);
    const gaps = tracked.filter((f) => sel.classify(f, map).kind === "unknown-source");
    // a new area of the repo needs a rule in risk-map.json, or it is verified at full cost forever
    expect(gaps).toEqual([]);
  });
});

describe("renamed and deleted files", () => {
  it("classifies both paths of a rename that crosses subsystems", () => {
    const p = run([
      change("ui-source/src/state/a.ts", "D", ["committed"], { renamedTo: "online/src/b.ts" }),
      change("online/src/b.ts", "R", ["committed"], { oldPath: "ui-source/src/state/a.ts" }),
    ]);
    expect(ids(p)).toEqual(expect.arrayContaining(["tc-ui", "tc-online"]));
    expect(p.classes).toEqual(expect.arrayContaining(["franchise-rules", "online-server"]));
    expect(p.notes.join(" ")).toContain("renamed to online/src/b.ts");
    expect(p.changes.map((c) => c.path)).toEqual(["online/src/b.ts", "ui-source/src/state/a.ts"]);
  });

  it("still typechecks a deleted source file, and says what a deletion can break", () => {
    const p = run([change("online/src/phases.ts", "D", ["unstaged"])]);
    expect(ids(p)).toContain("tc-online");
    expect(ids(p)).toContain("circuits");
    expect(ids(p, "recommended")).toContain("full-online"); // nothing is left to trace a related run from
    expect(p.notes.join(" ")).toContain("was deleted");
  });

  it("flags a deleted test as less coverage and runs nothing for it", () => {
    const p = run([change("ui-source/src/state/reveal.test.ts", "D", ["committed"])]);
    expect(p.notes.join(" ")).toMatch(/deleted/);
    expect(ids(p)).toContain("tc-ui");
    expect(ids(p).some((i) => i.startsWith("direct:"))).toBe(false);
  });

  it("treats a deleted file in a high-risk area as high risk", () => {
    expect(run([change(".github/workflows/deploy-render.yml", "D")]).risk).toBe("high");
    expect(run([change("src/engine/synergy.ts", "D")]).risk).toBe("high");
  });
});

describe("choosing the tests that import a changed file", () => {
  it("finds engine tests that import it directly", () => {
    const p = run([change("src/engine/synergy.ts")]);
    const direct = p.required.find((c) => c.id === "direct:engine");
    expect(direct?.files).toEqual(expect.arrayContaining(["test/engine-synergy.test.ts", "test/engine-gameplan-levers.test.ts"]));
    expect(direct?.commands[0]).toMatch(/^npx vitest run test\/engine-/);
  });

  it("finds UI and online tests through the @/ alias, with paths relative to their own project", () => {
    const p = run([change("ui-source/src/state/reveal.ts")]);
    const ui = p.required.find((c) => c.id === "direct:ui");
    const online = p.required.find((c) => c.id === "direct:online");
    expect(ui?.commands[0]).toContain("npm --prefix ui-source run test -- src/state/");
    expect(ui?.files).toContain("ui-source/src/state/reveal.test.ts");
    expect(online?.files).toContain("online/test/preseason-block.test.ts");
    expect(online?.commands[0]).toContain("npx vitest run --root online --no-file-parallelism test/"); // result-visibility needs a database
  });

  it("runs the changed test itself when only a test changed", () => {
    const p = run([change("online/test/hot-seat.test.ts", "M", ["unstaged"])]);
    expect(p.required.find((c) => c.id === "direct:online")?.files).toEqual(["online/test/hot-seat.test.ts"]);
  });

  it("requires the transitive related-tests run when nothing imports a source file", () => {
    const index = [test_("test/a.test.ts", ["src/engine/other"])];
    const p = run([change("src/engine/orphan.ts", "A", ["untracked"])], index);
    expect(ids(p)).toContain("related-engine");
    expect(p.notes.join(" ")).toContain("no test imports it directly");
    expect(p.required.find((c) => c.id === "related-engine")?.commands[0]).toBe("npx vitest related src/engine/orphan.ts --run");
  });

  it("matches a test sitting beside the file with the same name, and an index file by its folder", () => {
    const index = [test_("ui-source/src/state/thing.test.ts", [], "ui"), test_("test/x.test.ts", ["src/engine/folder"])];
    expect(sel.directTestsFor("ui-source/src/state/thing.ts", index).map((t) => t.path)).toEqual(["ui-source/src/state/thing.test.ts"]);
    expect(sel.directTestsFor("src/engine/folder/index.ts", index).map((t) => t.path)).toEqual(["test/x.test.ts"]);
    expect(sel.directTestsFor("src/engine/unrelated.ts", index)).toEqual([]);
  });

  it("reads import, export-from, dynamic import and vi.mock specifiers", () => {
    const src = `import a from "./a.js"; export { b } from "../b"; const c = await import("./c.ts"); vi.mock("@/d"); import "pkg";`;
    expect(sel.extractSpecifiers(src).sort()).toEqual(["../b", "./a.js", "./c.ts", "@/d", "pkg"]);
    expect(sel.specifierKey("../src/blocks.js", "online/test/x.test.ts")).toBe("online/src/blocks");
    expect(sel.specifierKey("@/state/reveal.ts", "online/test/x.test.ts")).toBe("ui-source/src/state/reveal");
    expect(sel.specifierKey("vitest", "test/x.test.ts")).toBeNull();
  });

  it("switches to the full suite rather than build an enormous command", () => {
    const many = Array.from({ length: 60 }, (_, i) => change(`src/engine/gen${i}.ts`, "A", ["untracked"]));
    const p = run(many, []);
    const related = p.required.find((c) => c.id === "related-engine");
    expect(related?.commands).toEqual(["npm test"]);
  });
});

describe("required and recommended checks", () => {
  it("separates them, and a check wanted at both levels is required", () => {
    const p = run([change("src/engine/sim.ts"), change("ui-source/src/state/contracts.ts")]);
    const req = ids(p);
    const rec = ids(p, "recommended");
    expect(req.filter((i) => rec.includes(i))).toEqual([]);
    expect(req).toEqual(expect.arrayContaining(["tc-engine", "engine-realism", "stat-guard", "full-engine", "ci-pr"]));
    expect(rec).toEqual(expect.arrayContaining(["stats-deep", "league-metrics"]));
    // full-ui is recommended for franchise rules and not otherwise required here
    expect(rec).toContain("full-ui");
    // but another rule that REQUIRES it promotes it, whichever change is seen first
    const pair = [change("ui-source/src/state/contracts.ts"), change("package.json")];
    for (const order of [pair, [...pair].reverse()]) {
      const promoted = run(order);
      expect(ids(promoted)).toContain("full-ui");
      expect(ids(promoted, "recommended")).not.toContain("full-ui");
    }
  });

  it("asks for only the scope check on a docs-only change", () => {
    const p = run([change("docs/decisions.md"), change("CLAUDE.md")]);
    expect(ids(p)).toEqual(["scope"]);
    expect(p.risk).toBe("none");
    expect(p.approvalsNeeded).toEqual([]);
  });

  it("orders checks cheapest first", () => {
    const p = run([change("src/engine/sim.ts")]);
    const tiers = p.required.map((c) => c.tier);
    expect([...tiers].sort((a, b) => a - b)).toEqual(tiers);
  });

  it("marks CI as the authoritative check and never as something run locally", () => {
    const ci = run([change("src/engine/sim.ts")]).required.find((c) => c.id === "ci-pr");
    expect(ci).toMatchObject({ kind: "ci", authoritative: true, commands: [] });
  });

  it("states that a local plan is not the CI result", () => {
    expect(run([change("docs/a.md")]).localVersusCi).toMatch(/GitHub CI/);
  });
});

describe("database changes", () => {
  it("flags the need for a database and the limits of the local one", () => {
    const p = run([change("online/src/db.ts")]);
    expect(p.needsDatabase).toBe(true);
    expect(ids(p)).toContain("db-suites");
    expect(ids(p, "recommended")).toContain("ci-repeat-db");
    const text = p.notes.join(" ");
    expect(text).toMatch(/PGlite/);
    expect(text).toMatch(/deadlocks|concurrency/);
    expect(p.required.find((c) => c.id === "db-suites")).toMatchObject({ env: { CI: "true", DB_POOL_MAX: "1" } });
    expect(p.approvalsNeeded.join(" ")).toMatch(/schema|migrations/i);
  });

  it("marks a direct database suite as needing one, and says a skip is not a pass", () => {
    const p = run([change("online/test/lobby.test.ts", "M", ["unstaged"])]);
    const d = p.required.find((c) => c.id === "direct:online");
    expect(d?.needsDatabase).toBe(true);
    expect(d?.note).toMatch(/skip is not a pass/);
    expect(p.needsDatabase).toBe(true);
  });

  it("does not claim a database for changes that do not touch one", () => {
    expect(run([change("ui-source/src/components/Foo.tsx")]).needsDatabase).toBe(false);
  });

  it("requires failure-not-skip checking for the test infrastructure itself", () => {
    const p = run([change("online/test/requireDatabase.ts")]);
    expect(ids(p)).toEqual(expect.arrayContaining(["infra-checks", "db-suites"]));
  });
});

describe("approvals", () => {
  it.each([
    ["src/engine/sim.ts", /formulas or balance/],
    ["artifacts/models/portable/x.json", /balance/],
    [".github/workflows/deploy-render.yml", /CI or deployment/],
    ["package.json", /Dependencies/],
    ["online/schema.sql", /schema/i],
  ])("%s needs approval", (path, pattern) => {
    expect(run([change(path)]).approvalsNeeded.join(" ")).toMatch(pattern);
  });

  it("needs none for a UI-only or docs-only change", () => {
    expect(run([change("ui-source/src/components/Foo.tsx")]).approvalsNeeded).toEqual([]);
    expect(run([change("docs/a.md")]).approvalsNeeded).toEqual([]);
  });
});

describe("scratch files", () => {
  it("lists an untracked scratch file without asking for checks for it", () => {
    const p = run([change("online/test/_probe.test.ts", "A", ["untracked"])]);
    expect(p.scratchPaths).toEqual(["online/test/_probe.test.ts"]);
    expect(ids(p)).toEqual(["scope"]);
    expect(p.problems).toEqual([]);
    expect(p.warnings.join(" ")).toContain("untracked scratch file");
  });

  it("reports a staged or committed scratch file as a problem, and still checks it", () => {
    const staged = run([change("online/test/_probe.test.ts", "A", ["staged"])]);
    expect(staged.problems.join(" ")).toMatch(/staged: scratch files must not be committed/);
    expect(ids(staged)).toContain("tc-online");
    const committed = run([change("online/dev/_x.ts", "A", ["committed"])]);
    expect(committed.problems.join(" ")).toMatch(/committed/);
  });

  it("leaves a tracked double-underscore test alone", () => {
    const p = run([change("ui-source/src/state/__soak.test.ts")]);
    expect(p.problems).toEqual([]);
    expect(p.scratchPaths).toEqual([]);
  });
});

describe("changes spanning several subsystems", () => {
  const changes = [
    change("src/engine/synergy.ts"),
    change("ui-source/src/state/contracts.ts", "M", ["staged"]),
    change("online/src/index.ts", "M", ["unstaged"]),
    change(".github/workflows/deploy-render.yml", "M", ["committed"]),
    change("online/src/newfile.ts", "A", ["untracked"]),
  ];

  it("takes the union of the checks and the highest risk", () => {
    const p = run(changes);
    expect(p.risk).toBe("high");
    expect(ids(p)).toEqual(expect.arrayContaining(["tc-engine", "tc-ui", "tc-online", "visibility", "static-review", "full-engine", "ci-pr"]));
    expect(new Set(allIds(p)).size).toBe(allIds(p).length); // each check once
    expect(p.approvalsNeeded.length).toBeGreaterThanOrEqual(2);
    expect(p.classes).toEqual(expect.arrayContaining(["engine", "franchise-rules", "online-http-and-visibility", "ci-or-deploy-config"]));
  });

  it("gives the same plan whatever order the changes arrive in", () => {
    const a = JSON.stringify(run(changes));
    const b = JSON.stringify(run([...changes].reverse()));
    expect(b).toBe(a);
  });

  it("records where each change came from", () => {
    const p = run(changes);
    const row = (path: string) => p.changes.find((c) => c.path === path);
    expect(row("ui-source/src/state/contracts.ts")?.sources).toEqual(["staged"]);
    expect(row("online/src/newfile.ts")?.sources).toEqual(["untracked"]);
  });
});

describe("no changes", () => {
  it("says so, and warns that it may be the wrong branch", () => {
    const p = run([]);
    expect(p.empty).toBe(true);
    expect(ids(p)).toEqual(["scope"]);
    expect(p.notes.join(" ")).toMatch(/wrong branch|right branch/);
  });
});

describe("the risk map", () => {
  const root = ROOT;
  const known = new Set([...Object.keys(map.checks), "direct-tests", "run-changed-tests"]);

  it("refers only to checks that exist", () => {
    for (const rule of map.rules) {
      for (const id of [...rule.requires, ...(rule.recommends ?? [])]) expect(known.has(id), `${rule.id} -> ${id}`).toBe(true);
    }
    for (const id of map.unknown.conservative) expect(known.has(id), `unknown -> ${id}`).toBe(true);
  });

  it("uses valid risk levels and unique rule ids", () => {
    const seen = new Set<string>();
    for (const rule of map.rules) {
      expect(sel.RISK_ORDER, rule.id).toContain(rule.risk);
      expect(seen.has(rule.id), `duplicate rule ${rule.id}`).toBe(false);
      seen.add(rule.id);
      expect(rule.match.length, rule.id).toBeGreaterThan(0);
    }
  });

  it("calls only npm scripts that exist", () => {
    const rootScripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts as Record<string, string>;
    const uiScripts = JSON.parse(readFileSync(join(root, "ui-source/package.json"), "utf8")).scripts as Record<string, string>;
    for (const [id, check] of Object.entries(map.checks)) {
      for (const cmd of check.commands) {
        const ui = /^npm --prefix ui-source run ([\w:-]+)/.exec(cmd);
        const rootRun = /^npm run ([\w:-]+)/.exec(cmd);
        if (ui) expect(uiScripts[ui[1] ?? ""], `${id}: ${cmd}`).toBeTruthy();
        else if (rootRun) expect(rootScripts[rootRun[1] ?? ""], `${id}: ${cmd}`).toBeTruthy();
        else if (cmd === "npm test") expect(rootScripts.test).toBeTruthy();
      }
    }
  });

  it("names only test files and scripts that exist", () => {
    for (const [id, check] of Object.entries(map.checks)) {
      for (const cmd of check.commands) {
        const base = cmd.includes("--root online") ? "online" : cmd.includes("--prefix ui-source") ? "ui-source" : ".";
        for (const token of cmd.split(/\s+/)) {
          if (/\.test\.ts$/.test(token) || /^analysis\/.+\.ts$/.test(token)) {
            expect(existsSync(join(root, base, token)), `${id}: ${token}`).toBe(true);
          }
        }
      }
    }
    for (const suite of map.databaseSuites) expect(existsSync(join(root, "online/test", suite)), suite).toBe(true);
  });

  it("lists only suites that really use the shared database helper", () => {
    for (const suite of map.databaseSuites) {
      expect(readFileSync(join(root, "online/test", suite), "utf8"), suite).toContain("prepareDatabase");
    }
  });

  it("keeps the test trees it indexes", () => {
    expect(realIndex.filter((t) => t.project === "engine").length).toBeGreaterThan(30);
    expect(realIndex.filter((t) => t.project === "ui").length).toBeGreaterThan(80);
    expect(realIndex.filter((t) => t.project === "online").length).toBeGreaterThan(40);
  });
});

describe("the command line", () => {
  const withChanges = (changes: unknown, args: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-cli-"));
    try {
      const file = join(dir, "changes.json");
      writeFileSync(file, JSON.stringify({ changes }));
      const out = execFileSync(process.execPath, [SCRIPT, "--cwd", ROOT, "--changes-file", file, ...args], { encoding: "utf8" });
      return out;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("prints a JSON plan and exits 0", () => {
    const out = withChanges([change("docs/a.md")], ["--json"]);
    const p = JSON.parse(out) as Plan;
    expect(p.required.map((c) => c.id)).toEqual(["scope"]);
  });

  it("prints a readable plan with REQUIRED and RECOMMENDED sections", () => {
    const out = withChanges([change("src/engine/sim.ts")]);
    expect(out).toMatch(/REQUIRED \(\d+\):/);
    expect(out).toMatch(/RECOMMENDED \(deeper; not needed/);
    expect(out).toContain("$ npm run typecheck");
    expect(out).toMatch(/authoritative/);
  });

  it("exits 3 when the change has a problem, still printing the plan", () => {
    let status = 0;
    let stdout = "";
    try {
      withChanges([change("online/test/_x.test.ts", "A", ["staged"])]);
    } catch (e) {
      const err = e as { status: number; stdout: string };
      status = err.status;
      stdout = err.stdout;
    }
    expect(status).toBe(3);
    expect(stdout).toContain("PROBLEMS");
  });

  it("exits 2 on an unknown argument", () => {
    expect(() => execFileSync(process.execPath, [SCRIPT, "--nonsense"], { stdio: "pipe" })).toThrow(/Command failed/);
  });

  it("never runs a check itself: git is the only program it starts", () => {
    const text = readFileSync(SCRIPT, "utf8");
    expect(text.match(/execFileSync\(/g)?.length).toBe(1);
    expect(text).toContain('execFileSync("git"');
    // a bare spawn(...) / exec(...) call; `regex.exec(...)` is a method call and is fine
    expect(text).not.toMatch(/(?<![.\w])(?:spawn|spawnSync|exec|execSync)\(/);
  });
});

/* ------------------------------------------------------------------------------------------
 * Corrections after an independent review. Each test names the defect it pins.
 * ------------------------------------------------------------------------------------------ */

const every = (p: Plan) => [...p.required, ...p.recommended];
const allCommands = (p: Plan) => every(p).flatMap((c) => c.commands);

describe("a generated command is always runnable as written", () => {
  const scenarios: Array<[string, Change[], IndexedTest[]?]> = [
    ["a deleted source file", [change("online/src/phases.ts", "D", ["unstaged"])]],
    ["a renamed source file", [change("online/src/b.ts", "R", ["committed"], { oldPath: "online/src/a.ts" }), change("online/src/a.ts", "D", ["committed"], { renamedTo: "online/src/b.ts" })]],
    ["a rename across projects", [change("ui-source/src/state/a.ts", "D", ["committed"], { renamedTo: "online/src/b.ts" }), change("online/src/b.ts", "R", ["committed"], { oldPath: "ui-source/src/state/a.ts" })]],
    ["a runtime data file", [change("test/fixtures/verify-replay.json")]],
    ["an unknown jsx file", [change("tools/Thing.jsx", "A", ["untracked"])]],
    ["a source file nothing imports", [change("src/data/csv.ts")], []],
    ["an engine file", [change("src/engine/weather.ts")]],
    ["a ui state file", [change("ui-source/src/state/reveal.ts")]],
    ["an http file", [change("online/src/throttle.ts")]],
    ["a pool file", [change("ui-source/src/data/pool-2025.json")]],
  ];
  it.each(scenarios)("%s", (_name, changes, index) => {
    const p = run(changes, index);
    expect(every(p).length).toBeGreaterThan(0);
    for (const cmd of allCommands(p)) {
      // an unfilled placeholder such as <base>, {files} or <changed files> is a command nobody can run
      expect(cmd, cmd).not.toMatch(/[<>{}]/);
      expect(cmd, cmd).not.toMatch(/\brelated\s+(?:--|$)/); // `related` with no file after it
      expect(cmd.trim(), cmd).not.toBe("");
    }
  });

  it("prints the real base in the scope command", () => {
    const p = run([change("docs/a.md")], realIndex, { base: "origin/master", mergeBase: "0123456789abcdef0123456789abcdef01234567" });
    expect(p.required.find((c) => c.id === "scope")?.commands).toContain("git diff --stat 0123456789abcdef0123456789abcdef01234567");
  });

  it("never copies an unvetted --base into a command", () => {
    const p = run([change("docs/a.md")], realIndex, { base: "origin/master; rm -rf /", mergeBase: "not-a-sha; rm -rf /" });
    expect(p.required.find((c) => c.id === "scope")?.commands).toContain("git diff --stat HEAD");
    expect(JSON.stringify(allCommands(p))).not.toContain("rm -rf");
  });
});

describe("related-test commands select tests (they were empty before)", () => {
  const cmdOf = (p: Plan, id: string) => every(p).find((c) => c.id === id)!;

  it("puts online paths relative to the online root, which is where --root online looks", () => {
    const c = cmdOf(run([change("online/src/throttle.ts")]), "related-online");
    expect(c.commands).toEqual(["npx vitest related src/throttle.ts --root online --no-file-parallelism --run"]);
  });

  it("runs the UI related command inside ui-source, with the UI project's own vitest", () => {
    const c = cmdOf(run([change("ui-source/src/state/roasts.ts")]), "related-ui");
    expect(c.cwd).toBe("ui-source");
    expect(c.commands).toEqual(["npx vitest related src/state/roasts.ts --run"]);
  });

  it("reaches across projects with a relative path, not an unusable repo path", () => {
    const p = run([change("ui-source/src/state/reveal.ts")]);
    expect(cmdOf(p, "related-online").commands[0]).toBe("npx vitest related ../ui-source/src/state/reveal.ts --root online --no-file-parallelism --run");
  });

  it("keeps engine paths repo-relative", () => {
    const c = cmdOf(run([change("src/data/csv.ts")], []), "related-engine");
    expect(c.commands).toEqual(["npx vitest related src/data/csv.ts --run"]);
    expect(c.cwd).toBeUndefined();
  });

  // The decisive test: run what the selector generates, in collection-only mode, and require that
  // it finds test files. The old commands answered "No test files found" and ran nothing.
  const collectOnly = (c: { commands: string[]; cwd?: string }) => {
    const [cmd] = c.commands;
    const result = spawnSync(`${cmd} --testNamePattern=__none__`, { cwd: join(ROOT, c.cwd ?? "."), shell: true, encoding: "utf8", timeout: 120_000, env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
    return `${result.stdout}\n${result.stderr}`;
  };
  it.each([
    ["online", "online/src/throttle.ts", "related-online", undefined],
    ["ui", "ui-source/src/state/roasts.ts", "related-ui", undefined],
    ["engine", "src/data/csv.ts", "related-engine", [] as IndexedTest[]],
  ])("the generated %s command collects test files", { timeout: 150_000 }, (_n, file, id, index) => {
    const out = collectOnly(cmdOf(run([change(file)], index), id));
    expect(out).not.toMatch(/No test files found/i);
    expect(out).toMatch(/Test Files\s+(?:\d+ \w+\s*\|\s*)*\d+ skipped \((\d+)\)/);
    const total = Number(/Test Files[^\n]*\((\d+)\)/.exec(out)?.[1] ?? 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe("deleted and renamed files give a plan that can run", () => {
  it("falls back to the whole suite when a deleted file leaves nothing to trace from", () => {
    const p = run([change("online/src/phases.ts", "D", ["unstaged"])]);
    expect(ids(p, "recommended")).toContain("full-online");
    expect(every(p).find((c) => c.id === "related-online")).toBeUndefined();
  });

  it("selects tests for the new path of a rename and the whole suite for the old one", () => {
    const p = run([change("online/src/throttle2.ts", "R", ["committed"], { oldPath: "online/src/throttle.ts" }), change("online/src/throttle.ts", "D", ["committed"], { renamedTo: "online/src/throttle2.ts" })]);
    expect(ids(p, "recommended")).toContain("full-online");
    expect(allCommands(p).join(" ")).not.toMatch(/[<>{}]/);
  });
});

describe("files tests read at run time cannot silently select nothing", () => {
  it("runs the whole engine suite for a fixture under test/", () => {
    const p = run([change("test/fixtures/league-seed.json")]);
    expect(ids(p)).toContain("full-engine");
    expect(p.notes.join(" ")).toMatch(/no test imports it/);
  });

  it("runs the whole suite for a data file with no importing test, never a related run", () => {
    const p = run([change("online/src/seed-data.json", "A", ["unstaged"])], []);
    const related = every(p).find((c) => c.id === "related-online");
    expect(related?.commands).toEqual(["npm run online:test -- --no-file-parallelism"]); // the whole suite, not a related run that finds nothing
    expect(related?.needsDatabase).toBe(true); // and it is only the whole suite if a database was used
    expect(related?.note).toMatch(/not code/);
  });

  it("runs the whole online suite for a fixture under online/test", () => {
    expect(ids(run([change("online/test/fixtures/league.json")]))).toContain("full-online");
  });

  it("still runs the importing tests for a helper that tests import", () => {
    const index = [test_("test/a.test.ts", ["test/helpers"]), test_("test/b.test.ts", [])];
    const p = run([change("test/helpers.ts")], index);
    expect(p.required.find((c) => c.id === "direct:engine")?.files).toEqual(["test/a.test.ts"]);
    expect(ids(p)).not.toContain("full-engine");
  });
});

describe("unknown file types are verified conservatively", () => {
  it.each(["tools/Thing.jsx", "scripts/legacy.cts", "tools/thing.vue", "tools/thing.svelte", "Dockerfile", "online/Dockerfile", ".env", ".env.production", "Makefile"])("%s", (path) => {
    const p = run([change(path, "A", ["untracked"])]);
    expect(p.conservative).toBe(true);
    expect(p.unknownSourcePaths).toContain(path);
    expect(ids(p)).toEqual(expect.arrayContaining(["full-engine", "full-ui", "full-online", "ci-pr"]));
  });
});

describe("database checks are serialised and carry their setup", () => {
  it("gives the visibility check a prerequisite, a test database URL and --no-file-parallelism", () => {
    const c = every(run([change("online/src/index.ts")])).find((x) => x.id === "visibility")!;
    expect(c.needsDatabase).toBe(true);
    expect(c.prerequisite).toMatch(/5433/);
    expect(c.env).toMatchObject({ DATABASE_URL: "postgres://postgres@localhost:5433/postgres", DB_POOL_MAX: "1", CI: "true" });
    expect(c.commands[0]).toContain("--no-file-parallelism");
  });

  it("every check that needs a database says how to reach one", () => {
    for (const path of ["online/src/db.ts", "online/test/lobby.test.ts", "online/src/index.ts", "online/test/requireDatabase.ts"]) {
      for (const c of every(run([change(path)])).filter((x) => x.needsDatabase)) {
        expect(c.env, `${c.id} for ${path}`).toBeDefined();
        expect(c.prerequisite, `${c.id} for ${path}`).toBeDefined();
        if (c.commands.some((cmd) => /vitest run/.test(cmd))) expect(c.commands.join(" "), `${c.id}`).toContain("--no-file-parallelism");
      }
    }
  });

  it("serialises direct database suites when several are chosen together", () => {
    const p = run([change("online/test/lobby.test.ts", "M", ["unstaged"]), change("online/test/hot-seat.test.ts", "M", ["unstaged"])]);
    const d = p.required.find((c) => c.id === "direct:online")!;
    expect(d.needsDatabase).toBe(true);
    expect(d.commands[0]).toMatch(/^npx vitest run --root online --no-file-parallelism /);
  });

  it("does not add the flag to a command that touches no database suite", () => {
    const d = run([change("online/test/boxscore.test.ts", "M", ["unstaged"])]).required.find((c) => c.id === "direct:online")!;
    expect(d.needsDatabase).toBe(false);
    expect(d.commands[0]).not.toContain("--no-file-parallelism");
  });
});

describe("the data and tests the verification tooling reads", () => {
  // The replay fixture is read only by test/verify-replay.test.ts. Changing it alone used to select
  // scope, the engine typecheck and CI, and so never ran the one test that reads it.
  it.each(["test/fixtures/verify-replay.json", "test/verify-replay.test.ts", "test/verify-selector.test.ts", "test/verify-safety.test.ts"])("%s selects the tooling's own tests", (path) => {
    const p = run([change(path)]);
    expect(ids(p)).toEqual(expect.arrayContaining(["scope", "tc-engine", "selector-tests"]));
    expect(p.classes).toContain("verification-tooling");
    expect(ids(p)).not.toContain("full-engine");
  });

  it("makes that check run the replay test as well", () => {
    const check = sel.loadMap().checks["selector-tests"] as { commands: string[] };
    expect(check.commands[0]).toContain("test/verify-replay.test.ts");
    expect(check.commands[0]).toContain("test/verify-safety.test.ts");
  });
});

describe("paths git quotes when it writes them one per line", () => {
  // Without -z, git prints a path containing a quote, a tab, a backslash or a newline as a quoted, escaped
  // string that no line-based reader recognises as a file: the change was classified as nothing and only
  // the scope check was required. With -z the path is read exactly as written.
  const odd = ['online/src/we"ird.ts', "online/src/tab\there.ts", "online/src/back\\slash.ts", "online/src/new\nline.ts", "online/src/caf\u00e9.ts", "online/src/sp ace.ts"];

  it.each(odd)("reads %j exactly as written (NUL-separated)", (path) => {
    expect(sel.parseNameStatusZ(`M\0${path}\0`, "unstaged")).toEqual([{ path, status: "M", source: "unstaged" }]);
    expect(sel.parseUntrackedZ(`${path}\0other.ts\0`)[0]).toMatchObject({ path, status: "A" });
  });

  it("reads renames with both paths, and several entries in a row", () => {
    const out = sel.parseNameStatusZ("R100\0online/src/a b.ts\0online/src/tab\there.ts\0D\0test/x.test.ts\0M\0src/y.ts\0", "committed");
    expect(out).toEqual([
      { path: "online/src/tab\there.ts", oldPath: "online/src/a b.ts", status: "R", source: "committed" },
      { path: "test/x.test.ts", status: "D", source: "committed" },
      { path: "src/y.ts", status: "M", source: "committed" },
    ]);
    expect(sel.parseNameStatusZ("", "staged")).toEqual([]);
  });

  it.each(odd)("classifies a changed %j as a source file with its checks, not as nothing", (path) => {
    const p = run([change(path, "M", ["unstaged"])]);
    expect(p.unclassifiedPaths).toEqual([]);
    expect(p.risk).not.toBe("none");
    expect(ids(p)).toContain("tc-online");
  });

  it("collects such files from a real git repository where the file system allows the name", () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-quoted-"));
    try {
      const sh = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, stdio: "pipe", encoding: "utf8" });
      sh("init", "-q");
      writeFileSync(join(dir, "README.md"), "x");
      sh("add", "-A");
      sh("commit", "-qm", "init");
      sh("update-ref", "refs/remotes/origin/master", "HEAD");
      mkdirSync(join(dir, "online/src"), { recursive: true });
      const made: string[] = [];
      for (const n of ["tab\there.ts", "back\\slash.ts", 'we"ird.ts', "caf\u00e9.ts"]) {
        try {
          writeFileSync(join(dir, "online/src", n), "export {};\n");
          made.push(`online/src/${n}`);
        } catch {
          // this file system (Windows) cannot hold that name; the parser tests above cover it
        }
      }
      expect(made.length).toBeGreaterThan(0);
      const { changes } = sel.collectChanges({ cwd: dir, base: "origin/master" });
      for (const path of made) expect(changes.map((c) => c.path), path).toContain(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the full online run counts only if a database was used", () => {
  const full = (p: Plan) => [...p.required, ...p.recommended].find((x) => x.id === "full-online")!;

  it("is a database check with a prerequisite, a test database and serial files", () => {
    const c = full(run([change("online/src/phases.ts")]));
    expect(c.needsDatabase).toBe(true);
    expect(c.prerequisite).toMatch(/5433/);
    expect(c.env).toMatchObject({ CI: "true", DB_POOL_MAX: "1" });
    expect(c.commands).toEqual(["npm run online:test -- --no-file-parallelism"]);
  });

  it("is what a related-online fallback becomes, with the same requirement", () => {
    const p = run([change("online/src/seed-data.json", "A", ["unstaged"])], []);
    const related = [...p.required, ...p.recommended].find((c) => c.id === "related-online")!;
    expect(related.commands).toEqual(["npm run online:test -- --no-file-parallelism"]);
    expect(related.needsDatabase).toBe(true);
    expect(related.prerequisite).toBeDefined();
  });

  it("makes the plan say it needs a database whenever the whole online suite is selected", () => {
    expect(run([change("package.json")]).needsDatabase).toBe(true);
  });
});

describe("a transitive online run can reach database suites, so it is a database check", () => {
  // The reproduction from the review: `npx vitest related src/db.ts --root online --run` exited 0 with
  // "199 passed, 1 skipped" and touched no database, because the suites that need one return early.
  const relatedOnline = (p: Plan) => [...p.required, ...p.recommended].filter((c) => c.id === "related-online");

  it("is a database check, serial, with a prerequisite and a test database, on the ordinary path", () => {
    // no direct test imports this file, so the transitive run is REQUIRED (the ordinary path, not the full-suite fallback)
    const p = run([change("online/src/orphan.ts", "A", ["unstaged"])], []);
    const [c] = p.required.filter((x) => x.id === "related-online");
    expect(c).toBeDefined();
    expect(c!.commands).toEqual(["npx vitest related src/orphan.ts --root online --no-file-parallelism --run"]);
    expect(c!.needsDatabase).toBe(true);
    expect(c!.prerequisite).toMatch(/5433/);
    expect(c!.env).toMatchObject({ CI: "true", DB_POOL_MAX: "1" });
    expect(p.needsDatabase).toBe(true);
  });

  it("is one wherever it is chosen: required or recommended, from online, database or UI rules", () => {
    for (const path of ["online/src/db.ts", "online/src/throttle.ts", "online/src/phases.ts", "ui-source/src/state/reveal.ts", "ui-source/src/state/rules.ts"]) {
      const found = relatedOnline(run([change(path)]));
      expect(found.length, path).toBeGreaterThan(0);
      for (const c of found) {
        expect(c.needsDatabase, `${path}: ${c.id}`).toBe(true);
        expect(c.commands.join(" "), path).toMatch(/--no-file-parallelism/);
      }
    }
  });

  it("is not a database check for the engine or the UI, whose tests reach no database", () => {
    const p = run([change("src/data/csv.ts")], []);
    for (const id of ["related-engine"]) expect(p.required.find((c) => c.id === id)?.needsDatabase).toBe(false);
    const ui = [...run([change("ui-source/src/state/roasts.ts")]).recommended].find((c) => c.id === "related-ui");
    expect(ui?.needsDatabase).toBe(false);
  });

  it("makes the plan say it needs a database, so a run without one cannot complete it", () => {
    expect(run([change("online/src/orphan.ts", "A", ["unstaged"])], []).needsDatabase).toBe(true);
  });
});

describe("the list of database suites cannot silently miss one", () => {
  // direct:online decides it needs a database by test file name. A new database suite that is not in the list
  // would be run without one, return early, and count as passed.
  it("names every online test that sets up a database", () => {
    const dir = join(ROOT, "online/test");
    const users = readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts"))
      .filter((f) => /\bprepareDatabase\(/.test(readFileSync(join(dir, f), "utf8")))
      .filter((f) => f !== "require-database.test.ts"); // tests prepareDatabase itself with a fake pool
    expect(users.length).toBeGreaterThan(5);
    expect([...users].sort()).toEqual([...map.databaseSuites].sort());
  });

  it("makes a direct run of any listed suite a serial database check", () => {
    for (const name of map.databaseSuites) {
      const d = run([change(`online/test/${name}`, "M", ["unstaged"])]).required.find((c) => c.id === "direct:online")!;
      expect(d.needsDatabase, name).toBe(true);
      expect(d.commands[0], name).toContain("--no-file-parallelism");
    }
  });
});

describe("the browser test harness", () => {
  it.each(["e2e/playwright.config.ts", "e2e/support/guard.ts", "e2e/specs/draft.spec.ts", "e2e/fixtures/build.ts", "e2e/README.md"])("%s is classified, not left to the conservative default", (path) => {
    const p = run([change(path)]);
    expect(p.classes).toContain("browser-e2e");
    expect(p.unknownSourcePaths).toEqual([]);
    expect(p.conservative).toBe(false);
    expect(p.notes.join(" ")).toMatch(/npm run e2e/);
  });

  it("treats the new dev dependency as a dependency change, which needs approval and the full suites", () => {
    const p = run([change("package.json"), change("package-lock.json")]);
    expect(p.classes).toContain("dependencies");
    expect(p.approvalsNeeded.join(" ")).toMatch(/Dependencies/);
    expect(ids(p)).toEqual(expect.arrayContaining(["full-engine", "full-ui", "full-online", "ui-build"]));
  });
});
