/**
 * Where downloaded engine files are kept between visits: the Cache Storage API, one cache for the engine.
 * Files are stored under their absolute, content-hashed URL, so a URL always means the same bytes; a new engine
 * has new URLs and the old entries are removed once the new one is running (`keepOnly`). The last manifest is
 * kept too, so a reload with no connection can still start the engine it already has.
 */
export const CACHE_NAME = "sim-engine-v1";

export interface AssetStore {
  get(url: string): Promise<ArrayBuffer | undefined>;
  /** true only if the entry was really written: a full disk or a refused write is `false`, never silently lost */
  put(url: string, bytes: ArrayBuffer, contentType: string): Promise<boolean>;
  delete(url: string): Promise<void>;
  /** removes every entry whose URL is not in `urls` */
  keepOnly(urls: ReadonlySet<string>): Promise<void>;
}

/** Cache Storage, or a store that remembers nothing when the browser has none (private modes, insecure origins). */
export function cacheStorageStore(storage: CacheStorage | null | undefined): AssetStore {
  if (!storage) return nullStore;
  let opened: Promise<Cache> | null = null;
  const cache = () => (opened ??= storage.open(CACHE_NAME));
  // a failure to read or write the cache costs a download, never the game; but a failed write is reported, because the
  // caller must not drop a working engine in favour of one that was not saved
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };
  return {
    get: (url) =>
      safe(async () => {
        const hit = await (await cache()).match(url);
        return hit ? await hit.arrayBuffer() : undefined;
      }, undefined),
    put: (url, bytes, contentType) =>
      safe(async () => {
        await (await cache()).put(url, new Response(bytes.slice(0), { headers: { "content-type": contentType } }));
        return true;
      }, false),
    delete: (url) =>
      safe(async () => {
        await (await cache()).delete(url);
      }, undefined),
    keepOnly: (urls) =>
      safe(async () => {
        const c = await cache();
        for (const req of await c.keys()) if (!urls.has(req.url)) await c.delete(req);
      }, undefined),
  };
}

const nullStore: AssetStore = {
  get: async () => undefined,
  put: async () => false,
  delete: async () => {},
  keepOnly: async () => {},
};
