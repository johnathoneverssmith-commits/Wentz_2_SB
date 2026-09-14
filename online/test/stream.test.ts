import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { announce, attachWatcher, watcherCount } from "../src/stream.js";

/**
 * The stream's bookkeeping, without a database.
 *
 * What matters about a push channel is not that it can push — it's who gets
 * a frame, what counts as a repeat, and whether a watcher that goes away
 * actually goes away. None of those need Postgres, which is why
 * `attachWatcher` is separate from `openStream`.
 *
 * The event summaries in a frame come from the database and are absent here;
 * that's the designed degradation, and the last test pins it.
 */
class FakeRes extends EventEmitter {
  written: string[] = [];
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
  /** Frames only, with the `event:`/`data:` envelope parsed off. */
  frames(): { event: string; data: unknown }[] {
    return this.written
      .filter((w) => w.startsWith("event:"))
      .map((w) => {
        const [head, body] = w.split("\n");
        return {
          event: head!.slice("event: ".length),
          data: JSON.parse(body!.slice("data: ".length)) as unknown,
        };
      });
  }
  as(): ServerResponse {
    return this as unknown as ServerResponse;
  }
}

const closers: (() => void)[] = [];
const attach = (res: FakeRes, league: string, user: string, version = "7"): void => {
  closers.push(attachWatcher(res.as(), league, user, { version, lastEventId: 0 }));
};

afterEach(() => {
  for (const close of closers.splice(0)) close();
});

describe("the change stream", () => {
  it("greets a new watcher with the version it is joining at", () => {
    const res = new FakeRes();
    attach(res, "L1", "u1", "12");
    expect(res.written[0]).toContain("retry:");
    expect(res.frames()).toEqual([{ event: "hello", data: { version: "12" } }]);
  });

  it("sends a change to every watcher of that league and nobody else", async () => {
    const a = new FakeRes();
    const b = new FakeRes();
    const other = new FakeRes();
    attach(a, "L1", "u1");
    attach(b, "L1", "u2");
    attach(other, "L2", "u3");

    await announce("L1", "8");

    expect(a.frames().at(-1)).toMatchObject({ event: "change", data: { version: "8" } });
    expect(b.frames().at(-1)).toMatchObject({ event: "change", data: { version: "8" } });
    expect(other.frames().map((f) => f.event)).toEqual(["hello"]);
  });

  it("ignores a version it has already announced", async () => {
    const res = new FakeRes();
    attach(res, "L1", "u1", "7");
    await announce("L1", "7");
    await announce("L1", "8");
    await announce("L1", "8");
    expect(res.frames().filter((f) => f.event === "change")).toHaveLength(1);
  });

  it("forgets a watcher whose connection closed", async () => {
    const res = new FakeRes();
    attach(res, "L1", "u1");
    expect(watcherCount("L1")).toBe(1);
    res.emit("close");
    expect(watcherCount("L1")).toBe(0);
    await announce("L1", "99");
    expect(res.frames().filter((f) => f.event === "change")).toHaveLength(0);
  });

  it("does not double-count a watcher that closes twice", () => {
    const res = new FakeRes();
    attach(res, "L1", "u1");
    const second = new FakeRes();
    attach(second, "L1", "u2");
    res.emit("close");
    res.emit("close");
    expect(watcherCount("L1")).toBe(1);
  });

  it("still reports the change when the summaries can't be read", async () => {
    // no database here, so the feed read fails; the version is the news and
    // it has to arrive regardless
    const res = new FakeRes();
    attach(res, "L1", "u1", "1");
    await announce("L1", "2");
    const change = res.frames().at(-1);
    expect(change).toMatchObject({ event: "change", data: { version: "2", events: [] } });
  });
});
