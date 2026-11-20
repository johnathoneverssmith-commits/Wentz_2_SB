#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const DEFAULT_UI = "https://wentz-2-sb-2.onrender.com";

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function localCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function meta(html, name) {
  const tag = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, "i"))?.[0];
  return tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
}

function sameCommit(left, right) {
  if (!left || !right || left === "unknown" || right === "unknown") return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

async function fetchText(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "cache-control": "no-cache" },
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function inspect(uiUrl, apiOverride) {
  const nonce = `deploy-check=${Date.now()}`;
  const html = await fetchText(`${uiUrl.replace(/\/$/, "")}/?${nonce}`);
  const ui = {
    commit: meta(html, "franchise-commit"),
    branch: meta(html, "franchise-branch"),
    builtAt: meta(html, "franchise-builtAt"),
  };
  const apiUrl = apiOverride ?? meta(html, "franchise-api");
  if (!apiUrl) throw new Error("The UI does not publish its API URL. Deploy the metadata change first or pass --api.");
  const apiResponse = await fetchText(`${apiUrl.replace(/\/$/, "")}/version?${nonce}`);
  const engine = { ui: await inspectEngine(uiUrl), api: await inspectEngine(apiUrl) };
  return { ui, api: JSON.parse(apiResponse), apiUrl, engine };
}

/**
 * The browser simulation engine a service serves (issue #74 Phase 4b): its manifest, and every file the manifest
 * names, present at the size promised. Both services build their own copy from the same commit, so the two
 * `engineVersion`s must be equal.
 */
async function inspectEngine(baseUrl) {
  const base = `${baseUrl.replace(/\/$/, "")}/sim-engine/`;
  const manifest = JSON.parse(await fetchText(`${base}manifest.json?deploy-check=${Date.now()}`));
  if (manifest.format !== 1 || typeof manifest.engineVersion !== "string") throw new Error(`${base}manifest.json is not a simulation engine manifest`);
  for (const key of ["worker", "artifacts", "pool"]) {
    const entry = manifest[key];
    const response = await fetch(new URL(entry.url, base), { cache: "no-store" });
    if (!response.ok) throw new Error(`${base}${entry.url} returned HTTP ${response.status}`);
    const bytes = (await response.arrayBuffer()).byteLength;
    if (bytes !== entry.bytes) throw new Error(`${base}${entry.url} is ${bytes} bytes, the manifest says ${entry.bytes}`);
  }
  return manifest.engineVersion;
}

function report(result, expected) {
  console.log(`UI:  ${result.ui.commit ?? "missing metadata"} (${result.ui.branch ?? "unknown branch"})`);
  console.log(`API: ${result.api.commit ?? "missing metadata"} (${result.api.branch ?? "unknown branch"})`);
  console.log(`Simulation engine: UI ${result.engine.ui.slice(0, 12)}, API ${result.engine.api.slice(0, 12)}`);
  console.log(`Expected: ${expected}`);

  const failures = [];
  if (!sameCommit(result.ui.commit, result.api.commit)) {
    failures.push("The UI and API are running different commits.");
  }
  if (!sameCommit(result.ui.commit, expected)) {
    failures.push("The static UI has not deployed the expected commit.");
  }
  if (!sameCommit(result.api.commit, expected)) {
    failures.push("The online API has not deployed the expected commit.");
  }
  if (result.engine.ui !== result.engine.api) {
    failures.push(`The UI and API serve different simulation engines (${result.engine.ui.slice(0, 12)} and ${result.engine.api.slice(0, 12)}).`);
  }
  return failures;
}

const uiUrl = option("ui", process.env.DEPLOY_UI_URL ?? DEFAULT_UI);
const apiUrl = option("api", process.env.DEPLOY_API_URL);
const expected = option("expected", process.env.DEPLOY_EXPECTED_COMMIT ?? localCommit());
const waitSeconds = Number(option("wait-seconds", "0"));
const deadline = Date.now() + Math.max(0, waitSeconds) * 1000;

for (;;) {
  try {
    const result = await inspect(uiUrl, apiUrl);
    const failures = report(result, expected);
    if (failures.length === 0) {
      console.log("Deployment verified: UI and API are serving the expected commit and the same simulation engine.");
      process.exit(0);
    }
    if (Date.now() >= deadline) {
      for (const failure of failures) console.error(`ERROR: ${failure}`);
      console.error("Check both Render services are linked to master with Auto-Deploy set to On Commit.");
      process.exit(1);
    }
  } catch (error) {
    if (Date.now() >= deadline) {
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
  console.log("Render is not current yet; checking again in 15 seconds...");
  await new Promise((resolve) => setTimeout(resolve, 15_000));
}
