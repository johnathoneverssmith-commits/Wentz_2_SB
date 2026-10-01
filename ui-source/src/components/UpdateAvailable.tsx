import { useEffect, useState } from "react";

const loadedAt = Date.now();
const API = import.meta.env.VITE_LEAGUE_API ?? "http://localhost:8788";

/** The commit this page was built from (`franchise-commit`, set at deploy). */
function pageCommit(): string | null {
  const c = document.querySelector('meta[name="franchise-commit"]')?.getAttribute("content") ?? "";
  return /^[0-9a-f]{7,40}$/.test(c) ? c : null;
}

/**
 * "The game was updated — reload."
 *
 * A GM who keeps a tab open for days kept running the page they loaded
 * against whatever the server had become since: fixes didn't reach them, and
 * nothing said so. Only after the server has restarted since this page
 * loaded, onto a different commit — so the minutes when the two halves finish
 * deploying at different times don't ask anyone to reload for nothing.
 */
export function UpdateAvailable() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const mine = pageCommit();
    if (!mine) return;
    let live = true;
    const check = (): void => {
      if (document.hidden) return;
      void fetch(`${API}/version`, { credentials: "omit" })
        .then((r) => (r.ok ? r.json() : null))
        .then((v: { commit?: string; startedAt?: string } | null) => {
          if (!live || !v?.commit || !v.startedAt) return;
          const restartedSince = Date.parse(v.startedAt) > loadedAt;
          if (restartedSince && v.commit !== mine && /^[0-9a-f]{7,40}$/.test(v.commit)) setStale(true);
        })
        .catch(() => undefined);
    };
    const timer = setInterval(check, 15 * 60_000);
    document.addEventListener("visibilitychange", check);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="notice" role="status" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
      The game has been updated since you opened this page.{" "}
      <button type="button" className="btnlink" onClick={() => window.location.reload()}>
        Reload to get the latest
      </button>{" "}
      — your progress is saved, so nothing is lost.
    </div>
  );
}
