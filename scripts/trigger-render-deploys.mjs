#!/usr/bin/env node

const commit = process.env.COMMIT_SHA;
const hooks = [
  ["online API", process.env.API_DEPLOY_HOOK],
  ["static UI", process.env.UI_DEPLOY_HOOK],
];

if (!commit) throw new Error("COMMIT_SHA is required.");

for (const [name, hook] of hooks) {
  if (!hook) throw new Error(`Missing deploy hook for ${name}.`);
  const url = new URL(hook);
  url.searchParams.set("ref", commit);
  const response = await fetch(url, { method: "POST" });
  if (!response.ok && response.status !== 202) {
    throw new Error(`${name} deploy hook returned HTTP ${response.status}.`);
  }
  console.log(`${name} deployment requested for ${commit.slice(0, 12)}.`);
}
