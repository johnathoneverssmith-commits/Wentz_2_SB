/**
 * Once per run: build the UI, serve it from a process this run owns, and build the fixture saves.
 * The teardown ends the server and removes every temporary directory, whether the run passed, failed or timed out.
 */
import { rmSync } from "node:fs";

import { buildFixtures } from "./fixtures-build.ts";
import { startUi } from "./stack.ts";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const ui = await startUi();
  let fixtures: { dir: string; ms: number };
  try {
    fixtures = buildFixtures();
  } catch (e) {
    await ui.stop();
    throw e;
  }
  process.env.E2E_UI_ORIGIN = ui.origin;
  process.env.E2E_FIXTURE_DIR = fixtures.dir;
  console.log(`e2e: UI built in ${ui.buildMs} ms and served at ${ui.origin} (pid ${ui.pid}); fixtures built in ${fixtures.ms} ms`);

  return async () => {
    await ui.stop();
    rmSync(fixtures.dir, { recursive: true, force: true });
  };
}
