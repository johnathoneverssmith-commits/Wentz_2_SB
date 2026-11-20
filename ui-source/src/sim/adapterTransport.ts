import type { Transport } from "./transportType.ts";

/** Where the local engine adapter (`npm run server`) listens. */
export const ADAPTER_BASE_URL = "http://localhost:8787";

/** Requests answered by the local adapter. A leaf module: nothing here needs the UI's path aliases. */
export const adapterTransport: Transport = async (path, body, signal) => {
  const res = await fetch(`${ADAPTER_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });
  if (!res.ok) throw new Error(`adapter ${path} -> ${res.status}`);
  return await res.json();
};
