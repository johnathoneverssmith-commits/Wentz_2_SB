import { useEffect, useRef, useState } from "react";

import { onlineSession } from "@/state/online";

const KEY = "fs.turnAlerts";

const supported = (): boolean => typeof window !== "undefined" && "Notification" in window;
const pushSupported = (): boolean =>
  supported() && "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;

const fromB64u = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/**
 * Real push: the league server notifies this device when it's your turn,
 * a trade offer arrives or a stage opens, with the game closed
 * (`online/src/push.ts`). The in-tab alerts below stay as the fallback for a
 * browser without push. (On an iPhone, push needs the game added to the home
 * screen first; Safari's rule.)
 */
async function subscribePush(): Promise<boolean> {
  const session = onlineSession();
  if (!session || !pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.register("./sw.js");
    await navigator.serviceWorker.ready;
    const { publicKey } = await session.client.pushKey();
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(publicKey) as BufferSource }));
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    await session.client.pushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } });
    return true;
  } catch {
    return false;
  }
}

async function unsubscribePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("./sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await onlineSession()?.client.pushUnsubscribe(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  } catch {
    // nothing to undo
  }
}

function readOn(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * A desktop notification when a turn comes round while the tab is in the
 * background. Online turns can be hours apart, and the only signal was the
 * tab title — fine if the tab is visible, useless if it's one of twenty.
 *
 * Opt-in, per device: the browser asks once, and the rail keeps a switch.
 */
export function TurnAlerts({
  yourTurn,
  stageLabel,
  offers = 0,
}: {
  yourTurn: boolean;
  stageLabel: string;
  /** Trade offers waiting on you — a new one is worth a nudge too. */
  offers?: number;
}) {
  const [on, setOn] = useState(readOn);
  // a browser that has the API but won't let a page use it (Android Chrome
  // wants a service worker) — the switch said "on" and nothing ever came
  const [unusable, setUnusable] = useState(false);
  // whether this device gets real push, not just in-tab alerts
  const [pushing, setPushing] = useState(false);
  // a device switched on before push existed signs up the next time it loads
  useEffect(() => {
    if (on && supported() && Notification.permission === "granted") void subscribePush().then(setPushing);
  }, [on]);
  const was = useRef(yourTurn);
  const offersWere = useRef(offers);

  useEffect(() => {
    const before = was.current;
    was.current = yourTurn;
    if (!on || before || !yourTurn || !supported() || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    try {
      const n = new Notification("Your turn — Franchise Sim", { body: stageLabel, tag: "fs-turn" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
  }, [yourTurn, on, stageLabel]);

  // a new trade offer arrived while the tab was in the background
  useEffect(() => {
    const before = offersWere.current;
    offersWere.current = offers;
    if (!on || offers <= before || !supported() || Notification.permission !== "granted" || !document.hidden) return;
    try {
      const n = new Notification("New trade offer — Franchise Sim", { body: "Another team made you an offer.", tag: "fs-offer" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // some browsers only allow notifications from a service worker
    }
  }, [offers, on]);

  if (!supported()) return null;

  const toggle = async (): Promise<void> => {
    let next = !on;
    if (next && Notification.permission !== "granted") {
      next = (await Notification.requestPermission()) === "granted";
    }
    if (next) {
      // one now, so switching it on is seen to work
      try {
        new Notification("Turn alerts are on — Franchise Sim", {
          body: "You'll get one when it's your turn and this tab is in the background.",
          tag: "fs-test",
        });
      } catch {
        next = false;
        setUnusable(true);
      }
    }
    if (next) setPushing(await subscribePush());
    else {
      await unsubscribePush();
      setPushing(false);
    }
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // private window: it just won't remember
    }
  };

  if (unusable) {
    return (
      <span className="turnalerts" role="status">
        This browser can&rsquo;t show turn alerts
      </span>
    );
  }
  const blocked = Notification.permission === "denied";
  return (
    <button
      type="button"
      className="turnalerts"
      onClick={() => void toggle()}
      disabled={blocked}
      title={blocked ? "Notifications are blocked for this site in your browser settings." : undefined}
      aria-pressed={on}
    >
      {blocked ? "Turn alerts blocked" : on ? (pushing ? "Turn alerts: on (push)" : "Turn alerts: on") : "Turn alerts: off"}
    </button>
  );
}
