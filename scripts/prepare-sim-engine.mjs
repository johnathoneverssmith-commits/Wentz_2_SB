/**
 * Builds the browser simulation engine into the UI's `public/sim-engine/` so Vite copies it beside `index.html`
 * (issue #74 Phase 4b). Called by both Render builds and by `npm --prefix ui-source run build`:
 *
 *   node scripts/prepare-sim-engine.mjs [outDir]
 *
 * Plain Node with no imports from the project, because it has to run where little is installed:
 *
 * - The league web service has already run `npm install` at the root (its `postinstall` is what calls this), so
 *   the engine's dependencies are there. Render installs with NODE_ENV=production; `esbuild` still arrives, as a
 *   dependency of `tsx`, which is a production dependency.
 * - The static site's Root Directory is `ui-source`, and it installs only `ui-source`'s dependencies. The engine
 *   needs `zod` and `tsx`/`esbuild` from the repo root, so this installs them there (production dependencies
 *   only, no lifecycle scripts) when they are missing. The repository is cloned whole, so the root is there.
 *
 * `--ignore-scripts` matters: the root `postinstall` builds the UI on Render and would call this again.
 * A failure here fails the build, so Render keeps serving the previous deploy rather than one with no engine.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ? resolve(process.argv[2]) : join(root, "ui-source/public/sim-engine");

if (!existsSync(join(root, "package.json")) || !existsSync(join(root, "src", "sim-service", "worker-entry.ts"))) {
  throw new Error(
    `sim engine: the repository root (${root}) isn't part of this build, so the engine can't be bundled. ` +
      "On a Render static site, clear Root Directory and set Build Command to `npm --prefix ui-source install && npm --prefix ui-source run build` " +
      "and Publish Directory to `ui-source/dist`.",
  );
}

const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
const have = (name) => existsSync(join(root, "node_modules", name, "package.json"));

if (!["zod", "tsx", "esbuild"].every(have)) {
  console.log("sim engine: installing the repo root's production dependencies (needed to bundle the engine)");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { SKIP_UI_BUILD: "1" });
  for (const name of ["zod", "tsx", "esbuild"]) {
    if (!have(name)) throw new Error(`sim engine: ${name} is still missing after installing the repo root's dependencies`);
  }
}

run(process.execPath, ["--import", "tsx", join("scripts", "build-sim-worker.ts"), out]);
