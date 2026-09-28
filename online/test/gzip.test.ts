import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { get, handle } from "../src/http.js";

/**
 * A league read is ~1.8 MB of JSON and every refresh fetches one. The gzip
 * check's word boundaries were once written as literal backspace characters,
 * so it matched nothing and every response went out uncompressed — with no
 * test to notice.
 */
describe("a large response", () => {
  it("is gzipped for a client that accepts it", async () => {
    get("/__gzip_probe", async () => ({ x: "a".repeat(10_000) }));
    const srv = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => srv.listen(0, r));
    const { port } = srv.address() as AddressInfo;
    try {
      const raw = await new Promise<{ enc?: string; body: Buffer }>((resolve, reject) => {
        import("node:http").then(({ request }) => {
          request({ port, path: "/__gzip_probe", headers: { "accept-encoding": "gzip, deflate, br" } }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve({ enc: res.headers["content-encoding"], body: Buffer.concat(chunks) }));
          })
            .on("error", reject)
            .end();
        }, reject);
      });
      expect(raw.enc).toBe("gzip");
      expect(raw.body.length).toBeLessThan(1000);
      expect(JSON.parse(gunzipSync(raw.body).toString()).x).toHaveLength(10_000);
    } finally {
      srv.close();
    }
  });
});
