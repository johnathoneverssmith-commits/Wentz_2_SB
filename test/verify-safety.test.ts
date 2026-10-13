import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as ci from "../.claude/skills/wentz-verify/ci-evidence.mjs";
import * as policy from "../.claude/skills/wentz-verify/command-policy.mjs";
import * as dbSafety from "../.claude/skills/wentz-verify/db-safety.mjs";
import * as evidence from "../.claude/skills/wentz-verify/evidence.mjs";
import * as runner from "../.claude/skills/wentz-verify/run-checks.mjs";
import * as sel from "../.claude/skills/wentz-verify/select-checks.mjs";
import type { Check } from "../.claude/skills/wentz-verify/select-checks.mjs";

/**
 * These tests are about what the verification tool must refuse, and what a run must never be allowed to
 * reach. A refusal that only works for the example in the comment is no refusal, so each section tries
 * the ways round it.
 */
const ROOT = fileURLToPath(new URL("../", import.meta.url));

const check = (id: string, extra: Partial<Check> = {}): Check => ({
  id, level: "REQUIRED", kind: "command", tier: 1, label: id, commands: ["npm run typecheck"], files: [], reasons: [], needsDatabase: false, ...extra,
});
const ok = (command: string, cwd = ".") => policy.validateCommand(command, { repoRoot: ROOT, cwd });
const refused = (command: string, cwd = ".") => {
  const v = ok(command, cwd);
  return v.ok ? null : v.reason;
};

describe("the command allowlist", () => {
  describe("accepts the checks this project really has", () => {
    it.each([
      "npm run typecheck",
      "npm run online:typecheck",
      "npm test",
      "npm run online:test",
      "npm --prefix ui-source run typecheck",
      "npm --prefix ui-source run build",
      "npm --prefix ui-source run test",
      "npm --prefix ui-source run test -- src/state/reveal.test.ts src/state/howItWorks.test.ts",
      "npx tsx analysis/39_league_metrics.ts",
      "npm run franchise:stress -- --mode smoke",
      "npm run online:test -- --no-file-parallelism",
      "npx vitest run test/engine-realism.test.ts",
      "npx vitest run test/engine-realism.test.ts test/verify-selector.test.ts",
      "npx vitest run --root online test/passing-volume.test.ts",
      "npx vitest run --root online --no-file-parallelism test/lobby.test.ts test/hot-seat.test.ts",
      "npx vitest run --no-file-parallelism --root online test/lobby.test.ts",
      "npx vitest related src/data/csv.ts --run",
      "npx vitest related src/throttle.ts src/boxscore.ts --root online --run",
      "npx vitest related ../ui-source/src/state/reveal.ts --root online --run",
    ])("%s", (command) => {
      expect(refused(command), command).toBeNull();
    });

    it("runs the UI related command from ui-source, and nothing else from there", () => {
      expect(refused("npx vitest related src/state/roasts.ts --run", "ui-source")).toBeNull();
      expect(refused("npm test", "ui-source")).toMatch(/only runs from the repository root/);
      expect(refused("npx vitest run test/engine-realism.test.ts", "ui-source")).toMatch(/only runs from the repository root/);
      expect(refused("npx vitest related src/throttle.ts --root online --run", "ui-source")).toMatch(/repository root/);
    });

    it("accepts every command the selector generates, for realistic changes in every area", () => {
      const map = sel.loadMap();
      const index = sel.buildTestIndex(ROOT, map);
      const paths = [
        "src/engine/weather.ts", "src/data/csv.ts", "server/index.ts", "online/src/throttle.ts", "online/src/phases.ts", "online/src/db.ts", "online/src/index.ts",
        "online/test/lobby.test.ts", "online/test/hot-seat.test.ts", "online/test/requireDatabase.ts", "ui-source/src/state/reveal.ts", "ui-source/src/state/howItWorks.ts",
        "ui-source/src/components/AppShell.tsx", "ui-source/src/util/format.ts", "test/engine-realism.test.ts", "test/fixtures/verify-replay.json", "package.json", "tools/Thing.jsx",
      ];
      let checked = 0;
      for (const path of paths) {
        const p = sel.plan({ changes: [{ path, status: "M", sources: ["unstaged"] }], testIndex: index, map, context: { base: "origin/master", mergeBase: "0123456789abcdef0123456789abcdef01234567" } });
        for (const c of [...p.required, ...p.recommended]) {
          if (c.kind !== "command") continue;
          for (const command of c.commands) {
            const v = policy.validateCommand(command, { repoRoot: ROOT, cwd: c.cwd ?? "." });
            expect(v.ok ? null : v.reason, `${path} -> ${c.id}: ${command}`).toBeNull();
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(50);
    });
  });

  describe("refuses anything else, however it is dressed", () => {
    const attempts: Array<[string, string]> = [
      // arbitrary code and other programs
      ['node -e "require(\'child_process\').execSync(\'calc\')"', "node -e"],
      ["node script.js", "a script"],
      ["node ./.claude/skills/wentz-verify/run-checks.mjs", "the runner itself"],
      ["git push origin master", "git"],
      ["gh pr merge 4 --squash", "gh"],
      ["curl https://example.com/x.sh", "curl"],
      ["powershell -Command Remove-Item x", "powershell"],
      ["cmd /c del x", "cmd"],
      ["rm -rf node_modules", "rm"],
      // other packages and scripts
      ["npx cowsay hi", "another package"],
      ["npx --yes left-pad", "npx --yes"],
      ["npx -c ls", "npx -c"],
      ["npx tsx analysis/other.ts", "another tsx script"],
      ["npx tsx online/src/migrate.ts", "the migration script"],
      ["npx vitest", "vitest with no subcommand"],
      ["npx vitest watch", "watch mode"],
      ["npm run online:migrate", "migrations"],
      ["npm run online:db", "starting a database"],
      ["npm run build", "an unlisted script"],
      ["npm run deploy", "a deploy script"],
      ["npm install left-pad", "npm install"],
      ["npm exec cowsay", "npm exec"],
      ["npm publish", "npm publish"],
      ["npm run typecheck --ignore-scripts", "an extra flag on a fixed command"],
      ["npm test -- --config evil.config.ts", "extra arguments on npm test"],
      ["npm test -u", "snapshot update"],
      // vitest options that change what runs
      ["npx vitest run -u test/verify-selector.test.ts", "-u"],
      ["npx vitest run --update test/verify-selector.test.ts", "--update"],
      ["npx vitest run --config evil.config.ts test/verify-selector.test.ts", "--config"],
      ["npx vitest run --root ui-source test/verify-selector.test.ts", "--root elsewhere"],
      ["npx vitest run --root online --root online test/lobby.test.ts", "--root twice"],
      ["npx vitest run --reporter=json test/verify-selector.test.ts", "--reporter"],
      ["npx vitest run --globalSetup evil.ts test/verify-selector.test.ts", "--globalSetup"],
      ["npx vitest run --coverage test/verify-selector.test.ts", "--coverage"],
      ["npx vitest run", "no test file"],
      ["npx vitest run --root online", "no test file after the root"],
      ["npx vitest related --run", "related with no file"],
      ["npx vitest related src/data/csv.ts", "related without --run"],
      ["npx vitest related src/data/csv.ts --run --coverage", "related with an extra flag"],
      ["npx vitest related src/throttle.ts --root ../ui-source --run", "related with another root"],
      // paths
      ["npx vitest run package.json", "a non-test file"],
      ["npx vitest run test/verify-selector.ts", "not a .test file"],
      ["npx vitest run test/does-not-exist.test.ts", "a file that does not exist"],
      ["npx vitest run /etc/passwd.test.ts", "an absolute path"],
      ["npx vitest run C:/Windows/evil.test.ts", "a drive path"],
      ["npx vitest run ../outside.test.ts", "leaving the project"],
      ["npx vitest run test/../test/verify-selector.test.ts", ".. inside a run path"],
      ["npx vitest run test//verify-selector.test.ts", "an empty segment"],
      ["npx vitest run node_modules/pkg/x.test.ts", "node_modules"],
      ["npx vitest related ../../outside.ts --run", "related outside the repository"],
      ["npx vitest related node_modules/vitest/index.js --run", "related inside node_modules"],
      ["npx vitest related src/data/csv.json --run", "related on a non-code file"],
      ["npm --prefix ui-source run test -- --config evil.ts", "an option as a UI test file"],
      ["npm --prefix ../other run test", "another prefix"],
      ["npm --prefix ui-source run build -- --mode evil", "extra build arguments"],
      ["./node_modules/.bin/vitest run test/verify-selector.test.ts", "an executable path"],
      ["C:/Program Files/nodejs/npm run typecheck", "an executable path with a drive"],
      ["npm.cmd run typecheck", "the .cmd name"],
      ["NODE_OPTIONS=--require=evil.js npm test", "an environment prefix"],
      ["VITEST_MODE=x npm test", "an environment prefix"],
    ];
    it.each(attempts)("%s (%s)", (command) => {
      expect(refused(command), command).not.toBeNull();
    });

    it.each([
      "npm test && git push", "npm test; git push", "npm test | tee out.txt", "npm test > out.txt", "npm test >> out.txt", "npm test < in.txt", "npm test & calc",
      "npm test $(whoami)", "npm test `whoami`", "npm test ${HOME}", "npm test %COMSPEC%", "npm test ^& calc", 'npm test "x"', "npm test 'x'", "npm test\nrm x", "npm test\r\nrm x",
      "npm test\tgit push", "npm test \\\\server\\share", "npm  test", " npm test", "npm test ", "", "   ",
    ])("%j", (command) => {
      expect(refused(command)).not.toBeNull();
    });

    it("explains what was wrong in terms a person can act on", () => {
      expect(refused("git push origin master")).toMatch(/not one of the verification commands/);
      expect(refused("npm test && x")).toMatch(/character that is not allowed/);
      expect(refused("npx vitest run test/nope.test.ts")).toMatch(/does not exist/);
      expect(refused("npx vitest run ../x.test.ts")).toMatch(/leaves the project/);
    });
  });

  describe("settings a check may carry", () => {
    it("allows only the three the checks use, with values of the right shape", () => {
      expect(policy.validateEnv({ DB_POOL_MAX: "1", CI: "true", STATS_SEEDS: "12" })).toEqual({ ok: true, env: { DB_POOL_MAX: "1", CI: "true", STATS_SEEDS: "12" } });
      for (const bad of [{ NODE_OPTIONS: "--require x" }, { PATH: "/evil" }, { DATABASE_PASSWORD: "x" }, { STATS_SEEDS: "12; x" }, { STATS_SEEDS: "0" }, { CI: "1" }, { DB_POOL_MAX: "100" }]) {
        expect(policy.validateEnv(bad as Record<string, string>).ok, JSON.stringify(bad)).toBe(false);
      }
    });

    it("ignores a DATABASE_URL in a plan: the one used is chosen on the command line", () => {
      expect(policy.validateEnv({ DATABASE_URL: "postgres://prod.example.com/prod", CI: "true" })).toEqual({ ok: true, env: { CI: "true" } });
    });
  });

  describe("starting a process", () => {
    const v = { argv: ["npx", "vitest", "run", "--root", "online", "test/lobby.test.ts"] };
    it("starts no shell on Linux", () => {
      expect(policy.launchSpec(v, { platform: "linux" })).toMatchObject({ file: "npx", args: ["vitest", "run", "--root", "online", "test/lobby.test.ts"], shell: false });
    });
    it("uses a shell on Windows, where npm and npx are .cmd files, only for a string that passed validation", () => {
      const spec = policy.launchSpec(v, { platform: "win32" });
      expect(spec).toMatchObject({ shell: true, file: "npx vitest run --root online test/lobby.test.ts" });
      expect(() => policy.launchSpec({ argv: ["npm", "test", "&", "calc"] }, { platform: "win32" })).toThrow(/unvalidated/);
      expect(() => policy.launchSpec({ argv: ["npm", "test$(x)"] }, { platform: "win32" })).toThrow(/unvalidated/);
    });
    it("quotes the one argument the tool appends itself (a scratch directory) and strips shell characters from it", () => {
      const spec = policy.launchSpec({ argv: ["npm", "run", "franchise:stress", "--", "--mode", "smoke"] }, { platform: "win32", appendArgs: ["--output", "C:\\Users\\a b\\Temp\\x&calc"] });
      expect(spec.file).toBe('npm run franchise:stress -- --mode smoke "--output" "C:\\Users\\a b\\Temp\\xcalc"');
    });
  });
});

describe("a verification run cannot reach a database it was not pointed at", () => {
  const PROD = "postgres://app_user:s3cret-pw@ep-prod-123.neon.tech.production.invalid:5432/neondb";
  const inherited: Record<string, string> = {
    ...(process.env as Record<string, string>),
    DATABASE_URL: PROD, TEST_DATABASE_URL: PROD, DATABASE_URL_UNPOOLED: PROD, DIRECT_URL: PROD, POSTGRES_URL: PROD, POSTGRES_PRISMA_URL: PROD,
    PGHOST: "ep-prod-123.neon.tech.production.invalid", PGPASSWORD: "s3cret-pw", PGUSER: "app_user", NEON_API_KEY: "napi_x", SUPABASE_DB_URL: PROD,
    REQUIRE_DATABASE: "1", DB_POOL_MAX: "50", RENDER_DATABASE_DSN: PROD, MY_DB_DSN: PROD,
  };

  describe("the environment a check starts with", () => {
    it("contains none of the database settings of the shell that started it", () => {
      const env = dbSafety.baseEnvironment(inherited);
      expect(Object.keys(env).filter((k) => dbSafety.isDatabaseVariable(k))).toEqual([]);
      expect(JSON.stringify(env)).not.toContain("s3cret-pw");
      expect(JSON.stringify(env)).not.toContain("production.invalid");
    });

    it("is built from a list, so a variable nobody anticipated is not passed on either", () => {
      const env = dbSafety.baseEnvironment({ PATH: "/bin", SOME_NEW_SECRET_URL: "https://x", CONNECTION_STRING: PROD, NODE_OPTIONS: "--require x", HOME: "/home/a" });
      expect(env).toEqual({ PATH: "/bin", HOME: "/home/a" });
    });

    it.each(["DATABASE_URL", "database_url", "TEST_DATABASE_URL", "DIRECT_URL", "POSTGRES_URL", "PGHOST", "PGPASSWORD", "PGSSLMODE", "NEON_API_KEY", "NEON_DATABASE_URL", "SUPABASE_DB_URL", "REQUIRE_DATABASE", "RENDER_DATABASE_DSN", "DB_POOL_MAX", "PRISMA_DATABASE_URL"])("treats %s as database configuration", (name) => {
      expect(dbSafety.isDatabaseVariable(name)).toBe(true);
    });
    it.each(["PATH", "HOME", "TEMP", "STATS_SEEDS", "CI", "NO_COLOR", "SYSTEMROOT"])("does not treat %s as one", (name) => {
      expect(dbSafety.isDatabaseVariable(name)).toBe(false);
    });
  });

  describe("choosing a test database", () => {
    it("accepts PGlite, and a database on this machine that is clearly a test database", () => {
      expect(dbSafety.resolveTestDatabase("local-pglite")).toMatchObject({ ok: true, url: "postgres://postgres@localhost:5433/postgres" });
      for (const url of ["postgres://postgres@localhost:5433/postgres", "postgresql://u:p@127.0.0.1:5433/anything", "postgres://u@localhost:5432/wentz_test", "postgres://u@[::1]:5433/postgres", "postgres://u@LOCALHOST:5433/postgres"]) {
        expect(dbSafety.resolveTestDatabase(url), url).toMatchObject({ ok: true });
      }
    });

    it("describes the choice without its credentials", () => {
      const r = dbSafety.resolveTestDatabase("postgres://u:topsecret@localhost:5433/postgres");
      expect(r).toMatchObject({ ok: true, description: "localhost:5433/postgres" });
      expect(JSON.stringify(r.ok ? r.description : "")).not.toContain("topsecret");
    });

    it.each([
      [undefined, "no choice at all"],
      ["", "an empty choice"],
      ["postgres://app:pw@ep-cool-name.neon.tech/neondb", "a hosted database"],
      ["postgres://app:pw@ep-cool-name.neon.tech:5433/test", "a hosted database that calls itself test"],
      ["postgres://u@localhost.evil.com:5433/postgres", "a host that merely starts with localhost"],
      ["postgres://u@127.0.0.1.nip.io:5433/test", "a name that resolves to loopback"],
      ["postgres://localhost@evil.example.com:5433/postgres", "a userinfo that looks like a host"],
      ["postgres://u@0.0.0.0:5433/postgres", "the unspecified address"],
      ["postgres://u@10.0.0.5:5433/postgres", "a private network address"],
      ["postgres://u@localhost:5433/postgres?host=prod.example.com", "a query that redirects the host"],
      ["postgres://u@localhost:5433/postgres?sslmode=require", "any query string"],
      ["postgres://u@localhost:5433/postgres#x", "a fragment"],
      ["postgres://u@localhost:5432/postgres", "a local database that is not clearly a test database"],
      ["postgres://u@localhost/postgres", "no port and no test name"],
      ["postgres://u@localhost:5433/production", "a database named production"],
      ["postgres://u@localhost:5433/prod_test", "a database named prod"],
      ["postgres://u@localhost:5432/live_test", "a database named live"],
      ["postgres://u@localhost:5433/", "no database name"],
      ["mysql://u@localhost:5433/test", "another protocol"],
      ["http://localhost:5433/test", "not a database URL"],
      ["file:///var/db/test", "a file URL"],
      ["not a url", "not a URL"],
      ["local-pglite ", "a near miss of the keyword"],
    ])("refuses %j (%s)", (selection, _why) => {
      const r = dbSafety.resolveTestDatabase(selection as string);
      expect(r.ok, String(selection)).toBe(false);
    });
  });

  describe("building a check's environment", () => {
    it("gives a check that needs no database no database at all, even when one is chosen and another is exported", () => {
      const r = dbSafety.environmentFor(check("t"), {}, { parentEnv: inherited, testDatabase: "local-pglite" });
      expect(r).toMatchObject({ ok: true, database: null });
      if (r.ok) expect(Object.keys(r.env).filter((k) => dbSafety.isDatabaseVariable(k))).toEqual([]);
    });

    it("refuses a check that needs a database when none was chosen, however many are exported", () => {
      const r = dbSafety.environmentFor(check("db", { needsDatabase: true }), {}, { parentEnv: inherited });
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.reason).toMatch(/no test database was chosen/);
    });

    it("refuses a chosen database that is the exported production one", () => {
      expect(dbSafety.environmentFor(check("db", { needsDatabase: true }), {}, { parentEnv: inherited, testDatabase: PROD }).ok).toBe(false);
    });

    it("gives a database check only the chosen database, one connection, and CI=true so a missing database fails", () => {
      const r = dbSafety.environmentFor(check("db", { needsDatabase: true }), { DB_POOL_MAX: "1", CI: "true" }, { parentEnv: inherited, testDatabase: "local-pglite" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.env).toMatchObject({ DATABASE_URL: dbSafety.LOCAL_PGLITE_URL, DB_POOL_MAX: "1", CI: "true" });
      expect(r.database).toBe("local PGlite on localhost:5433");
      for (const [k, val] of Object.entries(r.env)) {
        if (k !== "DATABASE_URL" && k !== "DB_POOL_MAX") expect(dbSafety.isDatabaseVariable(k), k).toBe(false);
        expect(String(val)).not.toContain("production.invalid");
      }
    });
  });

  describe("through the runner", () => {
    const scratch = () => {
      const dir = mkdtempSync(join(tmpdir(), "wentz-dbsafe-"));
      writeFileSync(join(dir, "probe.js"), "console.log('SEEN=' + JSON.stringify(Object.keys(process.env).filter((k) => /DATABASE|PG|POSTGRES|NEON|SUPABASE|DIRECT|DSN|REQUIRE|DB_/i.test(k)).sort()))");
      return dir;
    };
    const probePolicy: policy.Policy = { safeCharacters: policy.SAFE_COMMAND, extra: [(c) => (c === "node probe.js" ? { ok: true, kind: "probe", argv: ["node", "probe.js"], cwd: "." } : null)] };

    it("starts a check with none of the exported database variables", async () => {
      const dir = scratch();
      try {
        const rec = await runner.runCheck(check("a", { commands: ["node probe.js"] }), { cwd: dir, policy: probePolicy, parentEnv: inherited });
        expect(rec.output).toContain("SEEN=[]");
        expect(rec.output).not.toContain("production.invalid");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("gives a database check exactly the chosen database and nothing it inherited", async () => {
      const dir = scratch();
      try {
        const rec = await runner.runCheck(check("db", { commands: ["node probe.js"], needsDatabase: true, env: { DB_POOL_MAX: "1", CI: "true" } }), { cwd: dir, policy: probePolicy, parentEnv: inherited, testDatabase: "local-pglite" });
        expect(rec.output).toContain('SEEN=["DATABASE_URL","DB_POOL_MAX"]');
        expect(rec.database).toBe("local PGlite on localhost:5433");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("does not run a database check at all without a chosen test database, and spawns nothing", async () => {
      const dir = scratch();
      try {
        writeFileSync(join(dir, "probe.js"), "require('node:fs').writeFileSync('spawned.txt','x')");
        const rec = await runner.runCheck(check("db", { commands: ["node probe.js"], needsDatabase: true }), { cwd: dir, policy: probePolicy, parentEnv: inherited });
        expect(rec.error).toMatch(/refused to run: no test database was chosen/);
        expect(rec.commands).toEqual([]);
        expect(() => execFileSync(process.execPath, ["-e", "require('node:fs').readFileSync('spawned.txt')"], { cwd: dir, stdio: "pipe" })).toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("never lets an exported production URL initialise a database when it runs the online tests", { timeout: 240_000 }, async () => {
      const command = "npx vitest run --root online test/require-database.test.ts";
      // the control: with the URL exported, the online tests' global setup does try to reach and migrate it
      // (a host that cannot resolve, so nothing real is touched); this is what the runner must prevent
      const control = spawnSync(command, { cwd: ROOT, shell: true, encoding: "utf8", timeout: 200_000, env: { ...inherited, NO_COLOR: "1", FORCE_COLOR: "0" } });
      expect(`${control.stdout}${control.stderr}`).toMatch(/\[test setup\] DATABASE SCHEMA NOT APPLIED/);

      const rec = await runner.runCheck(check("online-infra", { commands: [command] }), { cwd: ROOT, parentEnv: { ...inherited, NO_COLOR: "1", FORCE_COLOR: "0" }, timeoutSec: 200 });
      expect(rec.error).toBeUndefined();
      expect(rec.exitCode).toBe(0);
      expect(rec.output).toMatch(/Tests\s+\d+ passed/);
      expect(rec.output).not.toContain("[test setup]"); // no schema was applied, and none failed to be: no database was approached
      expect(rec.output).not.toContain("production.invalid");
      expect(rec.output).not.toContain("s3cret-pw");
    });
  });
});

describe("evidence is tied to what it is evidence of", () => {
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-evidence-"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "pipe", encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(dir, ".gitignore"), "ignored.log\n");
    writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "package.json"), '{"name":"t"}\n');
    git("add", "-A");
    git("commit", "-qm", "init");
    return { dir, git, state: () => evidence.fingerprint(dir) as evidence.RepoState };
  };

  it("canonical text does not depend on key order", () => {
    expect(evidence.canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(evidence.canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(evidence.canonical({ a: 1 })).not.toBe(evidence.canonical({ a: 2 }));
  });

  it("changes when a tracked file is edited, a file is added or deleted, HEAD moves, or a config file changes — and not when nothing does", () => {
    const { dir, git, state } = repo();
    try {
      const clean = state();
      expect(clean.dirty).toBe(false);
      expect(state().digest).toBe(clean.digest);

      writeFileSync(join(dir, "ignored.log"), "noise"); // git ignores it, so it is not state
      expect(state().digest).toBe(clean.digest);

      writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
      const edited = state();
      expect(edited.dirty).toBe(true);
      expect(edited.digest).not.toBe(clean.digest);

      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n"); // back to the same content
      expect(state().digest).toBe(clean.digest);

      writeFileSync(join(dir, "b.ts"), "x");
      const added = state();
      expect(added.digest).not.toBe(clean.digest);
      writeFileSync(join(dir, "b.ts"), "y"); // an untracked file's content counts, not only its name
      expect(state().digest).not.toBe(added.digest);
      rmSync(join(dir, "b.ts"));

      rmSync(join(dir, "a.ts"));
      expect(state().digest).not.toBe(clean.digest); // a deletion
      git("checkout", "--", "a.ts");

      writeFileSync(join(dir, "package.json"), '{"name":"t","scripts":{}}\n');
      const config = state();
      expect(config.config.find((c) => c.path === "package.json")?.hash).not.toBe(clean.config.find((c) => c.path === "package.json")?.hash);
      git("commit", "-qam", "config");
      const moved = state();
      expect(moved.head).not.toBe(clean.head);
      expect(moved.digest).not.toBe(clean.digest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads git's rename entries with both paths", () => {
    expect(evidence.parsePorcelainZ("R  new.ts\0old.ts\0 M a.ts\0?? z.ts\0")).toEqual(["a.ts", "new.ts", "old.ts", "z.ts"]);
    expect(evidence.parsePorcelainZ("")).toEqual([]);
  });

  it("reports an unreadable repository as an error rather than inventing a state", () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-nogit-"));
    try {
      expect(evidence.fingerprint(dir)).toMatchObject({ error: expect.stringMatching(/could not read the repository state/) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("whether a record still applies", () => {
    const state = { head: "h1", dirty: false, digest: "t1", files: [], config: [], runtime: [], node: "v1" };
    const c = check("tc", { commands: ["npm run typecheck"] });
    const plan = { base: "origin/master", mergeBase: "m", changes: [{ path: "a.ts", status: "M" }], required: [c], recommended: [] } as never;
    const bound = (over: Record<string, unknown> = {}) => ({ id: "tc", exitCode: 0, binding: { ...evidence.bindingFor(c, plan, state), ...over } });

    it("applies when plan, command, HEAD and files are all unchanged", () => {
      expect(evidence.bindingProblems(bound(), c, plan, state)).toEqual([]);
    });
    it.each([
      ["a different tree", { treeDigest: "t2" }, /files in the working tree have changed/],
      ["a different HEAD", { head: "h0" }, /HEAD has moved/],
      ["a different plan", { planDigest: "other" }, /plan has changed/],
      ["a different command", { commandDigest: "other" }, /command or its settings/],
    ])("does not apply with %s", (_name, over, why) => {
      expect(evidence.bindingProblems(bound(over), c, plan, state).join(" ")).toMatch(why);
    });
    it("does not apply to a changed command, a changed plan, or a record with no binding", () => {
      expect(evidence.bindingProblems(bound(), { ...c, commands: ["npm test"] }, plan, state).join(" ")).toMatch(/command or its settings/);
      expect(evidence.bindingProblems(bound(), c, { ...(plan as object), changes: [] } as never, state).join(" ")).toMatch(/plan has changed/);
      expect(evidence.bindingProblems({ id: "tc", exitCode: 0 }, c, plan, state).join(" ")).toMatch(/no binding/);
      expect(evidence.bindingProblems(bound(), c, plan, { error: "no git" } as never)).toEqual(["no git"]);
    });
    it("takes a different environment setting as a different command", () => {
      expect(evidence.commandDigest({ ...c, env: { STATS_SEEDS: "12" } })).not.toBe(evidence.commandDigest(c));
      expect(evidence.commandDigest({ ...c, cwd: "ui-source" })).not.toBe(evidence.commandDigest(c));
    });
  });

  it("appends attempts and reads the old format as unbound", () => {
    let h = evidence.normalizeHistory(undefined);
    h = evidence.appendRun(h, { id: "x", exitCode: 1 });
    h = evidence.appendRun(h, { id: "x", exitCode: 0 });
    h = evidence.appendRun(h, { id: "y", exitCode: 0 });
    expect(h.runs.map((r) => [r.id, r.attempt])).toEqual([["x", 1], ["x", 2], ["y", 1]]);
    expect(evidence.attemptsFor(h, "x")).toHaveLength(2);
    const legacy = evidence.normalizeHistory({ results: [{ id: "a", exitCode: 0 }] });
    expect(legacy.runs[0]).toMatchObject({ id: "a", evidence: "unbound", attempt: 1 });
  });
});

describe("GitHub CI evidence", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const run = (over: Record<string, unknown> = {}) => ({
    id: 11, name: "Test and deploy Render", head_sha: SHA, event: "pull_request", path: ".github/workflows/deploy-render.yml", status: "completed", conclusion: "success",
    created_at: "2026-01-02T00:00:00Z", run_number: 5, html_url: "https://github.com/o/r/actions/runs/11",
    pull_requests: [{ number: 12, base: { ref: "master" }, head: { sha: SHA } }], ...over,
  });
  /** GitHub's current record of pull request #12. */
  const pull = (over: Record<string, unknown> = {}) => ({
    number: 12, state: "open", html_url: "https://github.com/o/r/pull/12",
    head: { sha: SHA, ref: "feat/x", repo: { full_name: "o/r" } }, base: { ref: "master", repo: { full_name: "o/r" } }, ...over,
  });
  const jobs = (test = "success", deploy = "skipped") => ({ jobs: [{ name: "test", conclusion: test }, { name: "deploy", conclusion: deploy }] });
  const judge = (runs: unknown[], jobsBody: unknown = jobs(), over: Record<string, unknown> = {}) =>
    ci.validateCiEvidence({ headSha: SHA, dirty: false, runs: { workflow_runs: runs }, jobsFor: () => jobsBody, pullFor: (n: number) => (n === 12 ? pull() : undefined), repoFullName: "o/r", ...over } as never);

  it("trusts a completed pull_request run of the workflow for exactly this commit with test passed and deploy skipped", () => {
    expect(judge([run()])).toMatchObject({ validated: true, source: "github-api", event: "pull_request", test: "success", deploy: "skipped", headSha: SHA, runId: 11, pr: { number: 12, baseRef: "master" } });
  });

  it.each([
    ["a push run", [run({ event: "push" })], /no pull_request run/],
    ["a manual run", [run({ event: "workflow_dispatch" })], /no pull_request run/],
    ["a run for another commit", [run({ head_sha: "f".repeat(40) })], /no pull_request run/],
    ["another workflow", [run({ path: ".github/workflows/other.yml" })], /no pull_request run/],
    ["no run at all", [], /no pull_request run/],
    ["a run still going", [run({ status: "in_progress", conclusion: null })], /in_progress/],
    ["a failed run", [run({ conclusion: "failure" })], /concluded failure/],
    ["a cancelled run", [run({ conclusion: "cancelled" })], /concluded cancelled/],
  ])("does not trust %s", (_n, runs, why) => {
    const r = judge(runs);
    expect(r.validated).toBe(false);
    expect(r.reason).toMatch(why);
  });

  it("marks a failed run as a failure, not merely as missing", () => {
    expect(judge([run({ conclusion: "failure" })])).toMatchObject({ validated: false, failed: true });
    expect(judge([run()], jobs("failure"))).toMatchObject({ validated: false, failed: true });
    expect(judge([run()], jobs("success", "success"))).toMatchObject({ validated: false, failed: true });
    expect(judge([run()], jobs("success", "success")).reason).toMatch(/must not deploy/);
    expect(judge([])).not.toMatchObject({ failed: true });
  });

  describe("binds the run to the right pull request", () => {
    const withPull = (over: Record<string, unknown>) => judge([run()], jobs(), { pullFor: (n: number) => (n === 12 ? pull(over) : undefined) });

    it("accepts the open pull request whose head is this commit and whose base is master", () => {
      expect(withPull({})).toMatchObject({ validated: true, pr: { number: 12 } });
    });
    it("refuses a run that is attached to no pull request", () => {
      expect(judge([run({ pull_requests: [] })]).reason).toMatch(/not attached to a pull request/);
    });
    it("refuses a pull request that GitHub does not know, or that has moved on to another head", () => {
      expect(judge([run({ pull_requests: [{ number: 999, base: { ref: "master" } }] })]).reason).toMatch(/did not report pull request #999/);
      expect(withPull({ head: { sha: "f".repeat(40), repo: { full_name: "o/r" } } }).reason).toMatch(/now has head fffffff/);
    });
    it("refuses a pull request that is closed or merged", () => {
      expect(withPull({ state: "closed" }).reason).toMatch(/closed, not open/);
    });
    it("refuses a pull request retargeted away from master after the run, even for the same head commit", () => {
      const r = withPull({ base: { ref: "feat/wentz-verify-selector", repo: { full_name: "o/r" } } });
      expect(r.validated).toBe(false);
      expect(r.reason).toMatch(/targets feat\/wentz-verify-selector, not master/);
    });
    it("refuses a run made when the pull request targeted another branch", () => {
      expect(judge([run({ pull_requests: [{ number: 12, base: { ref: "feat/old" } }] })]).reason).toMatch(/targeted feat\/old, not master/);
    });
    it("refuses a pull request from or into another repository", () => {
      expect(withPull({ head: { sha: SHA, ref: "x", repo: { full_name: "fork/r" } } }).reason).toMatch(/not within o\/r/);
      expect(withPull({ base: { ref: "master", repo: { full_name: "other/r" } } }).reason).toMatch(/not within o\/r/);
    });
    it("accepts only the pull request number that was asked for", () => {
      expect(judge([run()], jobs(), { expectedPr: 12 }).validated).toBe(true);
      expect(judge([run()], jobs(), { expectedPr: 13 }).reason).toMatch(/belongs to pull request #12, not #13/);
    });
    it("accepts another base only when it is asked for", () => {
      const other = judge([run({ pull_requests: [{ number: 12, base: { ref: "release" } }] })], jobs(), { expectedBase: "release", pullFor: () => pull({ base: { ref: "release", repo: { full_name: "o/r" } } }) });
      expect(other.validated).toBe(true);
    });
    it("is not fooled by a synthetic payload that names an unrelated pull request", () => {
      const unrelated = pull({ number: 7, head: { sha: "e".repeat(40), repo: { full_name: "o/r" } } });
      expect(judge([run({ pull_requests: [{ number: 7, base: { ref: "master" } }] })], jobs(), { pullFor: (n: number) => (n === 7 ? unrelated : undefined) }).validated).toBe(false);
    });
  });

  it("needs both jobs to have been reported", () => {
    expect(judge([run()], { jobs: [{ name: "deploy", conclusion: "skipped" }] }).reason).toMatch(/no `test` job/);
    expect(judge([run()], { jobs: [{ name: "test", conclusion: "success" }] }).reason).toMatch(/no `deploy` job/);
    expect(judge([run()], {}).reason).toMatch(/did not report/);
  });

  it("uses the latest run when there are several", () => {
    const older = run({ id: 1, created_at: "2026-01-01T00:00:00Z", conclusion: "success" });
    const newer = run({ id: 2, created_at: "2026-01-03T00:00:00Z", conclusion: "failure" });
    expect(judge([older, newer])).toMatchObject({ validated: false, failed: true });
    expect(judge([newer, older])).toMatchObject({ validated: false, failed: true });
  });

  it("does not describe a working tree that has changes on top of the commit", () => {
    expect(judge([run()], jobs(), { dirty: true })).toMatchObject({ validated: false });
    expect(judge([run()], jobs(), { dirty: true }).reason).toMatch(/uncommitted or untracked/);
    expect(judge([run()], jobs(), { headSha: "short" }).validated).toBe(false);
  });

  it("works out the repository from the remote", () => {
    for (const url of ["https://github.com/o/r.git", "https://github.com/o/r", "git@github.com:o/r.git", "https://user@github.com/o/r.git\n", "ssh://git@github.com/o/r"]) {
      expect(ci.parseRemote(url), url).toEqual({ owner: "o", repo: "r" });
    }
    for (const url of ["https://evil.com/o/r.git", "https://github.com.evil.com/o/r", "file:///o/r", "", "not a url"]) expect(ci.parseRemote(url), url).toBeNull();
  });

  describe("fetching", () => {
    type Call = { url: string; init: { method?: string; headers?: Record<string, string> } };
    const fake = (calls: Call[], dep: { sha?: string; deploy?: string; status?: number } = {}) =>
      (async (url: string, init: Call["init"]) => {
        calls.push({ url, init });
        if (dep.status && dep.status !== 200) return { ok: false, status: dep.status, json: async () => ({}) } as Response;
        const body = url.includes("/jobs") ? jobs("success", dep.deploy ?? "skipped") : url.includes("/pulls/") ? pull() : { workflow_runs: [run({ head_sha: dep.sha ?? SHA })] };
        return { ok: true, status: 200, json: async () => body } as Response;
      }) as unknown as typeof fetch;

    it("asks GitHub only for this repository's runs and jobs, read-only", async () => {
      const calls: Call[] = [];
      const r = await ci.fetchCiEvidence({ owner: "o", repo: "r", headSha: SHA, dirty: false, fetchImpl: fake(calls), token: "", now: () => new Date("2026-02-01T00:00:00Z") });
      expect(r).toMatchObject({ validated: true, retrievedAt: "2026-02-01T00:00:00.000Z" });
      expect(calls.length).toBeGreaterThanOrEqual(3);
      expect(calls.some((c) => c.url.endsWith("/repos/o/r/pulls/12"))).toBe(true);
      for (const c of calls) {
        expect(c.url).toMatch(/^https:\/\/api\.github\.com\/repos\/o\/r\/(?:actions\/runs|pulls\/\d+)/);
        expect(c.init.method).toBe("GET");
        expect(c.init.headers?.Authorization).toBeUndefined();
      }
      expect(calls[0]?.url).toContain(`head_sha=${SHA}`);
    });

    it("sends a token only when one is configured", async () => {
      const calls: Call[] = [];
      await ci.fetchCiEvidence({ owner: "o", repo: "r", headSha: SHA, dirty: false, fetchImpl: fake(calls), token: "ghp_test" });
      expect(calls[0]?.init.headers?.Authorization).toBe("Bearer ghp_test");
    });

    it("does not call GitHub at all when the tree is dirty or the repository is unknown", async () => {
      const calls: Call[] = [];
      expect(await ci.fetchCiEvidence({ owner: "o", repo: "r", headSha: SHA, dirty: true, fetchImpl: fake(calls) })).toMatchObject({ validated: false });
      expect(await ci.fetchCiEvidence({ headSha: SHA, dirty: false, fetchImpl: fake(calls) })).toMatchObject({ validated: false });
      expect(calls).toEqual([]);
    });

    it("reports a network failure or an HTTP error as not validated, and says what to do about a 404", async () => {
      const boom = (async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }) as unknown as typeof fetch;
      expect(await ci.fetchCiEvidence({ owner: "o", repo: "r", headSha: SHA, dirty: false, fetchImpl: boom })).toMatchObject({ validated: false, reason: expect.stringMatching(/could not read GitHub/) });
      const r = await ci.fetchCiEvidence({ owner: "o", repo: "r", headSha: SHA, dirty: false, fetchImpl: fake([], { status: 404 }) });
      expect(r.reason).toMatch(/404.*GITHUB_TOKEN/);
    });

    it("does not accept the answer for a different commit", async () => {
      const r = await ci.fetchCiEvidence({ owner: "o", repo: "r", headSha: SHA, dirty: false, fetchImpl: fake([], { sha: "f".repeat(40) }) });
      expect(r.validated).toBe(false);
    });
  });
});

describe("the permissions of the files themselves", () => {
  it("the skill's scripts import only from node:, the skill folder, and nowhere that could run a plan's text", () => {
    const dir = join(ROOT, ".claude/skills/wentz-verify");
    mkdirSync(dir, { recursive: true });
    for (const name of ["command-policy.mjs", "db-safety.mjs", "evidence.mjs", "ci-evidence.mjs", "run-checks.mjs", "report.mjs", "verdict.mjs"]) {
      const text = execFileSync(process.execPath, ["-e", `process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(join(dir, name))},'utf8'))`], { encoding: "utf8" });
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);
      for (const i of imports) expect(i, `${name} imports ${i}`).toMatch(/^(node:[a-z_:/]+|\.\/[a-z-]+\.mjs)$/);
      expect(text, name).not.toMatch(/\beval\s*\(|new Function\s*\(|child_process.*\bexec\b\s*\(/);
    }
  });
});

describe("a timed-out check leaves nothing running", () => {
  // A check is `npm` -> `node` -> `vitest` -> workers. Killing only the first process leaves the rest
  // running, holding database connections, file handles and CPU. The parent here starts a grandchild
  // that records its pid and keeps writing; after a timeout it must be gone.
  const treePolicy: policy.Policy = {
    safeCharacters: policy.SAFE_COMMAND,
    extra: [(c) => (c === "node parent.js" ? { ok: true, kind: "tree", argv: ["node", "parent.js"], cwd: "." } : null)],
  };
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-tree-"));
    writeFileSync(join(dir, "parent.js"), "const { spawn } = require('node:child_process'); spawn(process.execPath, ['child.js'], { stdio: 'ignore' }); setTimeout(function () {}, 60000);");
    writeFileSync(join(dir, "child.js"), "const fs = require('node:fs'); fs.writeFileSync('pid.txt', String(process.pid)); setInterval(function () { fs.appendFileSync('beat.txt', 'x'); }, 100);");
    return dir;
  };

  it("ends the command's whole process tree when it times out, so no child keeps writing or holding the directory", { timeout: 90_000 }, async () => {
    const dir = setup();
    let pid = 0;
    try {
      // long enough for the grandchild to have started even when the machine is busy
      const rec = await runner.runCheck(check("a", { commands: ["node parent.js"] }), { cwd: dir, timeoutSec: 8, policy: treePolicy });
      expect(rec.timedOut).toBe(true);
      pid = Number(execFileSync(process.execPath, ["-e", "process.stdout.write(require('node:fs').readFileSync('pid.txt','utf8'))"], { cwd: dir, encoding: "utf8" }));
      expect(pid).toBeGreaterThan(0);
      await sleep(1200);
      expect(alive(pid), "the grandchild is still running").toBe(false);
      const size = execFileSync(process.execPath, ["-e", "process.stdout.write(String(require('node:fs').statSync('beat.txt').size))"], { cwd: dir, encoding: "utf8" });
      await sleep(600);
      const later = execFileSync(process.execPath, ["-e", "process.stdout.write(String(require('node:fs').statSync('beat.txt').size))"], { cwd: dir, encoding: "utf8" });
      expect(later, "the grandchild is still writing").toBe(size);
      rmSync(dir, { recursive: true, force: true }); // nothing holds the directory any more
    } finally {
      if (pid && alive(pid)) process.kill(pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns promptly on a timeout, and records it as one", { timeout: 60_000 }, async () => {
    const dir = setup();
    try {
      const started = Date.now();
      const rec = await runner.runCheck(check("a", { commands: ["node parent.js"] }), { cwd: dir, timeoutSec: 2, policy: treePolicy });
      expect(Date.now() - started).toBeLessThan(30_000);
      expect(rec).toMatchObject({ timedOut: true, exitCode: null });
    } finally {
      try {
        const pid = Number(execFileSync(process.execPath, ["-e", "process.stdout.write(require('node:fs').readFileSync('pid.txt','utf8'))"], { cwd: dir, encoding: "utf8" }));
        if (alive(pid)) process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("kills a tree by pid, and ignores a pid that is already gone", () => {
    expect(() => runner.killTree(undefined)).not.toThrow();
    expect(() => runner.killTree(2_147_000_000)).not.toThrow();
  });
});

describe("the evidence fingerprint covers what the tests read, without exposing secrets", () => {
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "wentz-runtime-"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, stdio: "pipe", encoding: "utf8" });
    git("init", "-q");
    writeFileSync(join(dir, ".gitignore"), "data/*.local.json\n.env\n.env.local\n");
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "package.json"), '{"name":"t"}\n');
    git("add", "-A");
    git("commit", "-qm", "init");
    return { dir, state: () => evidence.fingerprint(dir) as evidence.RepoState };
  };

  it("changes when an ignored runtime data file is created, edited or removed, as the engine tests read it when it exists", () => {
    const { dir, state } = repo();
    try {
      const none = state();
      expect(none.dirty).toBe(false); // git itself sees nothing
      writeFileSync(join(dir, "data/players.local.json"), "[1]");
      const made = state();
      expect(made.dirty).toBe(false); // still invisible to git status
      expect(made.digest).not.toBe(none.digest);
      writeFileSync(join(dir, "data/players.local.json"), "[2]");
      expect(state().digest).not.toBe(made.digest);
      writeFileSync(join(dir, "data/other.local.json"), "[]");
      const another = state();
      expect(another.runtime.some((r) => r.path === "data/other.local.json")).toBe(true);
      rmSync(join(dir, "data/players.local.json"));
      rmSync(join(dir, "data/other.local.json"));
      expect(state().digest).toBe(none.digest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes when an ignored environment file changes, and never records its content", () => {
    const { dir, state } = repo();
    try {
      const none = state();
      writeFileSync(join(dir, ".env"), "DATABASE_URL=postgres://app:hunter2-secret@prod.example.com/db\n");
      const withEnv = state();
      expect(withEnv.digest).not.toBe(none.digest);
      writeFileSync(join(dir, ".env"), "DATABASE_URL=postgres://app:other@prod.example.com/db\n");
      expect(state().digest).not.toBe(withEnv.digest);
      const text = JSON.stringify(state());
      for (const secret of ["hunter2-secret", "prod.example.com", "postgres://"]) expect(text).not.toContain(secret);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stale-marks an old pass when such a file appears (the reviewer's reproduction)", () => {
    const { dir, state } = repo();
    try {
      const c = check("tc", { commands: ["npm run typecheck"] });
      const plan = { base: "origin/master", mergeBase: "m", changes: [], required: [c], recommended: [] } as never;
      const before = state();
      const run = { id: "tc", exitCode: 0, binding: evidence.bindingFor(c, plan, before) };
      expect(evidence.bindingProblems(run, c, plan, before)).toEqual([]);
      writeFileSync(join(dir, "data/players.local.json"), "[]");
      expect(evidence.bindingProblems(run, c, plan, state()).join(" ")).toMatch(/files in the working tree have changed/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("the database a check ran against", () => {
    const state = { head: "h", dirty: false, digest: "d", files: [], config: [], runtime: [], node: "v1" };
    const c = check("db", { needsDatabase: true, commands: ["npm run online:test -- --no-file-parallelism"] });
    const plan = { base: "origin/master", mergeBase: "m", changes: [], required: [c], recommended: [] } as never;
    const digestOf = (url: string) => evidence.sha256(url);

    it("binds a digest of the chosen database, never its URL", () => {
      const env = dbSafety.environmentFor(c, { CI: "true", DB_POOL_MAX: "1" }, { testDatabase: "postgres://u:topsecret@localhost:5433/postgres" });
      expect(env.ok).toBe(true);
      if (!env.ok) return;
      expect(env.databaseDigest).toBe(digestOf("postgres://u:topsecret@localhost:5433/postgres"));
      const binding = evidence.bindingFor(c, plan, state, { databaseDigest: env.databaseDigest ?? null });
      expect(JSON.stringify(binding)).not.toContain("topsecret");
    });
    it("makes a database check without a recorded selection stale", () => {
      const run = { id: "db", exitCode: 0, binding: evidence.bindingFor(c, plan, state) };
      expect(evidence.bindingProblems(run, c, plan, state).join(" ")).toMatch(/no test database selection was recorded/);
    });
    it("makes a result for another database stale once a database is selected", () => {
      const run = { id: "db", exitCode: 0, binding: evidence.bindingFor(c, plan, state, { databaseDigest: digestOf("postgres://postgres@localhost:5433/postgres") }) };
      expect(evidence.bindingProblems(run, c, plan, state, { databaseDigest: digestOf("postgres://postgres@localhost:5433/postgres") })).toEqual([]);
      expect(evidence.bindingProblems(run, c, plan, state, { databaseDigest: digestOf("postgres://postgres@localhost:5432/other_test") }).join(" ")).toMatch(/different test database/);
    });
    it("does not ask a check that needs no database for one", () => {
      const plain = check("tc", { commands: ["npm run typecheck"] });
      const run = { id: "tc", exitCode: 0, binding: evidence.bindingFor(plain, plan, state) };
      expect(evidence.bindingProblems(run, plain, plan, state, { databaseDigest: "x" })).toEqual([]);
    });
  });
});

describe("a path inside the repository that leads outside it is refused", () => {
  // The name is inside the repository; a symlink (or a Windows junction) in it is not. Checking the name is not enough.
  const layout = () => {
    const base = mkdtempSync(join(tmpdir(), "wentz-link-"));
    const repo = join(base, "repo");
    const outside = join(base, "outside");
    mkdirSync(join(repo, "test"), { recursive: true });
    mkdirSync(join(repo, "online", "test"), { recursive: true });
    mkdirSync(join(repo, "ui-source", "src"), { recursive: true });
    mkdirSync(outside);
    writeFileSync(join(repo, "test", "ok.test.ts"), "export {};");
    writeFileSync(join(outside, "evil.test.ts"), "export {};");
    writeFileSync(join(outside, "evil.ts"), "export {};");
    return { base, repo, outside };
  };
  const link = (target: string, at: string) => {
    try {
      symlinkSync(target, at, "junction"); // a junction on Windows (no privilege needed); the type is ignored elsewhere
      return true;
    } catch {
      return false;
    }
  };
  const check_ = (command: string, repoRoot: string, cwd = ".") => policy.validateCommand(command, { repoRoot, cwd });

  it("accepts a real file and refuses the same name reached through a junction or symlink to somewhere else", () => {
    const { base, repo, outside } = layout();
    try {
      expect(check_("npx vitest run test/ok.test.ts", repo).ok).toBe(true);
      if (!link(outside, join(repo, "test", "linked"))) return; // this system cannot make a link: nothing to test
      const through = check_("npx vitest run test/linked/evil.test.ts", repo);
      expect(through.ok).toBe(false);
      expect(through.ok ? "" : through.reason).toMatch(/resolves outside the repository/);
      expect(check_("npx vitest run --root online test/ok.test.ts", repo).ok).toBe(false); // not there either
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a file that is itself a link to a file outside", () => {
    const { base, repo, outside } = layout();
    try {
      try {
        symlinkSync(join(outside, "evil.test.ts"), join(repo, "test", "sneaky.test.ts"), "file");
      } catch {
        return; // creating a file symlink needs a privilege on Windows
      }
      expect(check_("npx vitest run test/sneaky.test.ts", repo).ok).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses related files, UI test files and working directories that lead outside", () => {
    const { base, repo, outside } = layout();
    try {
      if (!link(outside, join(repo, "online", "linked"))) return;
      writeFileSync(join(repo, "online", "real.ts"), "export {};");
      expect(check_("npx vitest related linked/evil.ts --root online --run", repo).ok).toBe(false);
      expect(check_("npx vitest related real.ts --root online --run", repo).ok).toBe(true);
      expect(link(outside, join(repo, "ui-source", "src", "linked"))).toBe(true);
      expect(check_("npm --prefix ui-source run test -- src/linked/evil.test.ts", repo).ok).toBe(false);
      // a working directory that is itself a link to outside
      rmSync(join(repo, "ui-source"), { recursive: true, force: true });
      expect(link(outside, join(repo, "ui-source"))).toBe(true);
      const cwd = check_("npx vitest related evil.ts --run", repo, "ui-source");
      expect(cwd.ok).toBe(false);
      expect(cwd.ok ? "" : cwd.reason).toMatch(/resolves outside/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("still accepts a repository reached through a link to it, and links that stay inside", () => {
    const { base, repo } = layout();
    try {
      if (!link(repo, join(base, "alias"))) return;
      expect(check_("npx vitest run test/ok.test.ts", join(base, "alias")).ok).toBe(true);
      writeFileSync(join(repo, "online", "test", "inside.test.ts"), "export {};");
      if (link(join(repo, "online", "test"), join(repo, "test", "inner"))) {
        expect(check_("npx vitest run test/inner/inside.test.ts", repo).ok).toBe(true);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
