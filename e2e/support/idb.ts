/**
 * Reading and editing the app's save from a test, through the real IndexedDB the app uses.
 *
 * The app saves to IndexedDB (ui-source/src/state/durableSave.ts), so a test can no longer read
 * `localStorage`. These helpers first ask the app to finish any write in flight (`__nflSimFlushSave`, installed by
 * the store), so a read sees every change made so far, then read the record the way the app does — through
 * IndexedDB, plain or gzip. They never bypass IndexedDB: the fixtures are *seeded* as the old localStorage form,
 * which the app migrates into IndexedDB on first load, so migration is exercised by every test that starts from one.
 */
import type { Page } from "@playwright/test";

import { SAVE_KEY } from "./test.ts";

/** The save's JSON text (`{ state, version }`), or null when nothing is stored under the key. */
export async function readSaveText(page: Page, key: string = SAVE_KEY): Promise<string | null> {
  return page.evaluate(async (k) => {
    const w = window as unknown as { __nflSimFlushSave?: () => Promise<boolean> };
    await w.__nflSimFlushSave?.();
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const r = indexedDB.open("nfl-sim-ui-saves", 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains("saves")) r.result.createObjectStore("saves");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const get = () =>
      new Promise<{ enc: string; data: string | ArrayBuffer } | undefined>((res, rej) => {
        const q = db.transaction("saves", "readonly").objectStore("saves").get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    let rec = await get();
    // A seeded league sits in localStorage until the app has loaded and migrated it into IndexedDB (a moment after
    // the page opens). While the old copy is still there, the save is on its way: wait for it rather than report none.
    for (let i = 0; !rec && localStorage.getItem(k) != null && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      rec = await get();
    }
    db.close();
    if (!rec) return null;
    if (rec.enc === "plain") return rec.data as string;
    return new Response(new Blob([rec.data as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }, key);
}

/** The league state held in the save (the `state` of `{ state, version }`). */
export async function readSavedState<T = any>(page: Page, key: string = SAVE_KEY): Promise<T> {
  const text = await readSaveText(page, key);
  if (text == null) throw new Error(`no saved league under ${key}`);
  return (JSON.parse(text) as { state: T }).state;
}

/**
 * Replace the stored save with an edited one, as a valid IndexedDB record (length and checksum included), for the
 * tests that doctor a league and reload. The app's own pending writes are finished first so they cannot land after.
 */
export async function editSave(page: Page, edit: (doc: { state: any; version: number }) => void, key: string = SAVE_KEY): Promise<void> {
  const text = await readSaveText(page, key);
  if (text == null) throw new Error(`no saved league under ${key}`);
  const doc = JSON.parse(text) as { state: any; version: number };
  edit(doc);
  await writeSaveText(page, key, JSON.stringify(doc));
}

/** Store `json` as the save under `key` — a valid IndexedDB record, length and checksum included. */
export async function writeSaveText(page: Page, key: string, json: string): Promise<void> {
  const next = json;
  await page.evaluate(
    async ([k, json]) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < json.length; i++) {
        h ^= json.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const r = indexedDB.open("nfl-sim-ui-saves", 1);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction("saves", "readwrite");
        tx.objectStore("saves").put({ fmt: 1, enc: "plain", data: json, chars: json.length, sum: h >>> 0, savedAt: Date.now() }, k);
        tx.oncomplete = () => res();
        tx.onerror = tx.onabort = () => rej(tx.error);
      });
      db.close();
    },
    [key, next] as [string, string],
  );
}
