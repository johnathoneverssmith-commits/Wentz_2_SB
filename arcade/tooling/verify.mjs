import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Explicit arcade coverage: the franchise pipeline does not discover this module.
const cwd = fileURLToPath(new URL("..", import.meta.url));
const commands = [
  ["typecheck", "../node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
  ["unit tests", "../node_modules/vitest/vitest.mjs", "run", "--config", "vitest.config.ts"],
  ["local build", "../ui-source/node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts", "--configLoader", "runner"],
  ["browser tests", "../node_modules/@playwright/test/cli.js", "test", "--config", "playwright.config.ts"],
];
for (const [label, ...args] of commands) {
  console.log(`\nArcade verification: ${label}`);
  try { execFileSync(process.execPath, args, { cwd, stdio: "inherit" }); }
  catch { console.error(`Arcade verification failed: ${label}`); process.exit(1); }
}
console.log("\nArcade verification passed: typecheck, unit tests, build and browser tests.");
