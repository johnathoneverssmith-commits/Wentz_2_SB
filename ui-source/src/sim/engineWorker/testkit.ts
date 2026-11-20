/**
 * Fakes for the browser engine's page side: an in-memory Cache Storage, a "site" serving a built engine directory,
 * and a worker that is the real host behind a structured-clone message boundary. Used by the client tests and the
 * service tests. Imports the repo-root engine, so (like the tests) it is outside `tsc -b`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createSimHost, type HostRequest } from "../../../../src/sim-service/worker-host.ts";
import type { WorkerLike } from "./client.ts";

export const ORIGIN = "https://game.example/";
export const BASE = `${ORIGIN}sim-engine/`;

// ---- fakes -------------------------------------------------------------------------------------------------------

export class FakeCacheStorage {
  readonly caches = new Map<string, Map<string, { bytes: ArrayBuffer; type: string }>>();
  async open(name: string) {
    const entries = this.caches.get(name) ?? new Map();
    this.caches.set(name, entries);
    return {
      match: async (url: string) => {
        const e = entries.get(url);
        return e ? new Response(e.bytes.slice(0), { headers: { "content-type": e.type } }) : undefined;
      },
      put: async (url: string, res: Response) => {
        if (this.failPutFor && url.includes(this.failPutFor)) throw new DOMException("quota", "QuotaExceededError");
        entries.set(url, { bytes: await res.arrayBuffer(), type: res.headers.get("content-type") ?? "" });
      },
      delete: async (req: string | Request) => entries.delete(typeof req === "string" ? req : req.url),
      keys: async () => [...entries.keys()].map((u) => new Request(u)),
    };
  }
  /** a write to any entry whose URL contains this fails, as a full disk's would */
  failPutFor: string | null = null;
  get entries(): string[] {
    return [...(this.caches.get("sim-engine-v1")?.keys() ?? [])].sort();
  }
  corrupt(urlPart: string) {
    for (const [u, e] of this.caches.get("sim-engine-v1") ?? []) if (u.includes(urlPart)) new Uint8Array(e.bytes)[10] ^= 0xff;
  }
}

/** The "server": serves a built engine directory; every request is recorded; `fail` can break any of them. */
export class FakeSite {
  readonly requests: string[] = [];
  fail: ((path: string, attempt: number) => Response | Error | undefined) | null = null;
  /** when set, every response waits for it */
  hold: Promise<void> | null = null;
  private attempts = new Map<string, number>();
  constructor(public dir: string) {}
  fetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.replace("/sim-engine/", "");
    this.requests.push(path);
    if (this.hold) await this.hold;
    const n = (this.attempts.get(path) ?? 0) + 1;
    this.attempts.set(path, n);
    const broken = this.fail?.(path, n);
    if (broken instanceof Error) throw broken;
    if (broken) return broken;
    try {
      const body = readFileSync(join(this.dir, path));
      return new Response(body, { headers: { "content-type": path.endsWith(".js") ? "text/javascript" : "application/json" } });
    } catch {
      return new Response("nope", { status: 404 });
    }
  };
  assetRequests() {
    return this.requests.filter((r) => r !== "manifest.json");
  }
}

export class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  private host = createSimHost();
  constructor(private mode: "normal" | "silent" = "normal") {}
  postMessage(message: unknown, transfer: Transferable[] = []) {
    if (this.terminated) return;
    // the message boundary: a copy, and transferred buffers are detached in the sender
    const data = structuredClone(message, { transfer }) as HostRequest;
    if (this.mode === "silent") return;
    void this.host.handle(data).then((res) => {
      if (!this.terminated) this.onmessage?.({ data: res });
    });
  }
  crash(message = "boom") {
    this.onerror?.({ message });
  }
  terminate() {
    this.terminated = true;
  }
}

