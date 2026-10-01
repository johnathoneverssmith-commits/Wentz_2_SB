import { useState } from "react";

const KEY = "fs.onlineIntroSeen";

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * How an online league moves, once, the first time a GM is in one.
 *
 * None of it is obvious from a single-player habit: nothing happens until
 * everyone checks in, some stages go one team at a time on a clock, and the
 * games are already played by the time you "simulate" them.
 */
export function OnlineIntro() {
  const [hidden, setHidden] = useState(seen);
  if (hidden) return null;
  const dismiss = (): void => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // private window: it'll show again next time, which is harmless
    }
  };
  return (
    <div className="notice" role="note" style={{ maxWidth: 820, margin: "0 auto 16px" }}>
      <strong>How an online league moves.</strong> The league goes stage by stage, and a stage ends when
      every GM has checked in — there&rsquo;s no clock on that, so it waits for everyone (the
      commissioner can move it on). Drafts, free agency and the trade deadline go one team at a time with
      a clock; if yours runs out, your staff makes a sensible move for you. Games are played when everyone
      checks in, and you watch them at your own pace without holding anyone up. The League wire — beside
      the page, or in your team hub on a phone — shows what everyone else is doing.{" "}
      <button type="button" className="btnlink sm" onClick={dismiss}>
        Got it
      </button>
    </div>
  );
}
