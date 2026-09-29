import { useEffect, useRef, useState } from "react";

const KEY = "fs.turnAlerts";

const supported = (): boolean => typeof window !== "undefined" && "Notification" in window;

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
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? "on" : "off");
    } catch {
      // private window: it just won't remember
    }
  };

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
      {blocked ? "Turn alerts blocked" : on ? "Turn alerts: on" : "Turn alerts: off"}
    </button>
  );
}
