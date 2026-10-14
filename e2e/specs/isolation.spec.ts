import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "../support/test.ts";

test.describe("the test browser can only reach this run's own UI", () => {
  test("loads the app from the server this run started, and starts empty", async ({ page, origin, consoleErrors }) => {
    const res = await page.goto("/");
    // the token proves the page came from this run's server, not from whatever else answers on a port
    expect(res?.headers()["x-e2e-token"]).toMatch(/^[0-9a-f]{24}$/);
    expect(page.url().startsWith(origin)).toBe(true);
    await expect(page.locator("#boot")).toHaveCount(0); // React replaced the loading placeholder
    expect(consoleErrors).toEqual([]);
  });

  test.describe("forbidden requests", () => {
    test.use({ allowAnyBlocked: true }); // they are made on purpose

    test("the engine adapter, the league API, a deployed site, the internet and another local port are all blocked, and none arrives", async ({ page, blocked }) => {
      const hits: string[] = [];
      const decoy = createServer((req, res) => {
        hits.push(req.url ?? "");
        res.end("decoy");
      });
      await new Promise<void>((r) => decoy.listen(0, "127.0.0.1", r));
      const decoyPort = (decoy.address() as AddressInfo).port;
      try {
        await page.goto("/");
        const targets = [
          "http://127.0.0.1:8787/health",
          "http://localhost:8787/",
          "http://[::1]:8787/",
          "http://localhost:8788/version",
          "https://wentz-2-sb-2.onrender.com/version",
          "https://example.com/",
          `http://127.0.0.1:${decoyPort}/decoy`,
          `http://localhost:${decoyPort}/decoy`,
        ];
        const outcome = await page.evaluate(
          (urls) =>
            Promise.all(
              urls.map(async (u) => {
                try {
                  await fetch(u, { mode: "no-cors" });
                  return "reached";
                } catch {
                  return "blocked";
                }
              }),
            ),
          targets,
        );
        expect(outcome).toEqual(targets.map(() => "blocked"));
        expect(hits, "the decoy local server received a request").toEqual([]);
        const seen = new Map(blocked.map((b) => [b.url, b.reason]));
        for (const t of targets) expect(seen.has(t), t).toBe(true);
        expect(seen.get("http://127.0.0.1:8787/health")).toBe("engine-adapter");
        expect(seen.get("http://localhost:8787/")).toBe("engine-adapter");
        expect(seen.get("http://[::1]:8787/")).toBe("engine-adapter");
        expect(seen.get("http://localhost:8788/version")).toBe("league-api");
        expect(seen.get("https://example.com/")).toBe("outside-origin");
      } finally {
        decoy.close();
      }
    });

    test("a WebSocket to anywhere but this origin is refused", async ({ page, blocked }) => {
      await page.goto("/");
      const state = await page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const ws = new WebSocket("ws://127.0.0.1:8787/socket");
            ws.onopen = () => resolve("open");
            ws.onerror = () => resolve("error");
            ws.onclose = () => resolve("closed");
            setTimeout(() => resolve("timeout"), 8000);
          }),
      );
      expect(["error", "closed"]).toContain(state);
      expect(blocked.some((b) => b.type === "websocket")).toBe(true);
    });
  });

  test("service workers are disabled: a registration the app attempts creates nothing", async ({ page, context }) => {
    const warnings: string[] = [];
    page.on("console", (m) => warnings.push(m.text()));
    await page.goto("/");
    // Playwright's block does not throw: it makes register() resolve to nothing, and says so on the console
    const outcome = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.register("./sw.js");
      return {
        returned: reg === undefined ? "nothing" : "a registration",
        registrations: (await navigator.serviceWorker.getRegistrations()).length,
        controlled: navigator.serviceWorker.controller !== null,
      };
    });
    expect(outcome).toEqual({ returned: "nothing", registrations: 0, controlled: false });
    expect(context.serviceWorkers()).toEqual([]);
    expect(warnings.some((w) => /Service Worker registration blocked by Playwright/.test(w))).toBe(true);
  });

  test("the only things a healthy page load tries to reach are known and blocked", async ({ page, blocked }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    // the noSurprises fixture fails the test on anything else; this documents what was seen
    const hosts = [...new Set(blocked.map((b) => new URL(b.url).host))].sort();
    test.info().annotations.push({ type: "blocked-on-boot", description: hosts.join(", ") || "(none)" });
    expect(hosts.every((h) => ["fonts.googleapis.com", "fonts.gstatic.com", "127.0.0.1:9", "localhost:8787", "127.0.0.1:8787", "localhost:8788", "127.0.0.1:8788"].includes(h))).toBe(true);
  });
});

test.describe.serial("every test gets a fresh browser", () => {
  test("one test leaves something in localStorage", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.setItem("e2e-marker", "left behind"));
    expect(await page.evaluate(() => window.localStorage.getItem("e2e-marker"))).toBe("left behind");
  });

  test("the next test does not see it", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => window.localStorage.getItem("e2e-marker"))).toBeNull();
  });
});
