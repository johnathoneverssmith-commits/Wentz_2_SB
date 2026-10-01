import { goLocal, lastLeagueId } from "./online";

/**
 * Online play moves to the league server's own address.
 *
 * Served from a second host (the static site), the UI's session cookie is a
 * third-party cookie, and Safari — every iPhone — refuses those: a GM signed
 * in and was signed straight back out. The league server now serves this same
 * UI itself, where the cookie is first-party, so a static-site build sends
 * online players there.
 *
 * Only online players: a single-player dynasty is saved in this browser under
 * this address, and moving it would look exactly like losing it. And only
 * once the server answers with the UI, so a server still on an older build —
 * or still waking up — leaves everyone where they are.
 */
export function moveOnlinePlayToLeagueOrigin(): void {
  const api = import.meta.env.VITE_LEAGUE_API;
  if (!import.meta.env.PROD || !api || !/^https:\/\//.test(api)) return;
  let target: URL;
  try {
    target = new URL(api);
  } catch {
    return;
  }
  if (target.origin === window.location.origin) return;

  // sent here from the league server's "back to your dynasty": this browser
  // is choosing single-player, so forget the league rather than bounce back
  if (new URLSearchParams(window.location.search).get("from") === "league") {
    goLocal();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
  }

  let checking = false;
  const consider = (): void => {
    const hash = window.location.hash;
    const online = hash.startsWith("#/online") || lastLeagueId() !== null;
    if (!online || checking) return;
    checking = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    fetch(`${target.origin}/`, { method: "HEAD", signal: ctrl.signal, credentials: "omit" })
      .then((res) => {
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return;
        // the league itself is remembered there, not here: start at the lobby
        window.location.replace(`${target.origin}/${hash.startsWith("#/online") ? hash : "#/online"}`);
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        checking = false;
      });
  };
  consider();
  window.addEventListener("hashchange", consider);
}

/**
 * Where a GM's single-player dynasty lives, when it isn't here.
 *
 * Built for the league server's own origin, the UI knows the static site's
 * address (`VITE_DYNASTY_ORIGIN`). A dynasty is saved in the browser under the
 * address it was played at, so "back to your dynasty" from here opened an
 * empty one — which looks exactly like the save being gone.
 */
function dynastyOrigin(): string | null {
  const o = import.meta.env.VITE_DYNASTY_ORIGIN;
  if (!o) return null;
  try {
    const url = new URL(o);
    return url.origin === window.location.origin ? null : url.origin;
  } catch {
    return null;
  }
}

/** Go to the single-player dynasty: its own address if it has one. True when it navigated away. */
export function leaveForDynasty(): boolean {
  const origin = dynastyOrigin();
  if (!origin) return false;
  window.location.assign(`${origin}/?from=league#/`);
  return true;
}
