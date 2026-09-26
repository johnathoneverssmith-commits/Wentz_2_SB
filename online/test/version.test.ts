import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { server } from "../src/index.js";

let baseUrl = "";

beforeAll(async () => {
  process.env.RENDER_GIT_COMMIT = "deployment-test-commit";
  process.env.RENDER_GIT_BRANCH = "master";
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  delete process.env.RENDER_GIT_COMMIT;
  delete process.env.RENDER_GIT_BRANCH;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("deployment identity", () => {
  it("reports the commit without requiring authentication or database access", async () => {
    const response = await fetch(`${baseUrl}/version`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      service: "online-api",
      commit: "deployment-test-commit",
      branch: "master",
    });
  });
});
