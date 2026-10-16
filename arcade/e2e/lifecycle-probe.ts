import type { Page } from "@playwright/test";

export interface LifecycleReading {
  keydown: number; keyup: number; blur: number; visibilitychange: number;
  setups: number; cleanups: number; pendingFrames: number; cancelledFrames: number;
}
declare global { interface Window { arcadeLifecycle: { read(): LifecycleReading } } }

/** Test-side browser instrumentation only. No application state or application hooks. */
export async function installLifecycleProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const active = new Map<string, Set<EventListenerOrEventListenerObject>>();
    let setups = 0, cleanups = 0, cancelledFrames = 0;
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    const tracked = (target: EventTarget, type: string) =>
      (target === window && ["keydown", "keyup", "blur"].includes(type)) || (target === document && type === "visibilitychange");
    const key = (type: string, options?: boolean | EventListenerOptions) => `${type}:${typeof options === "boolean" ? options : Boolean(options?.capture)}`;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (listener && tracked(this, type)) {
        const k = key(type, options), set = active.get(k) ?? new Set();
        set.add(listener); active.set(k, set);
        if (type === "keydown") setups++;
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      if (listener && tracked(this, type)) {
        active.get(key(type, options))?.delete(listener);
        if (type === "keydown") cleanups++;
      }
      return remove.call(this, type, listener, options);
    };
    const pending = new Set<number>();
    const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => {
      const id = request(time => { pending.delete(id); callback(time); });
      pending.add(id); return id;
    };
    window.cancelAnimationFrame = id => { pending.delete(id); cancelledFrames++; cancel(id); };
    window.arcadeLifecycle = { read: () => {
      const count = (type: string) => [...active].filter(([k]) => k.startsWith(`${type}:`)).reduce((n, [, callbacks]) => n + callbacks.size, 0);
      return { keydown: count("keydown"), keyup: count("keyup"), blur: count("blur"), visibilitychange: count("visibilitychange"), setups, cleanups, pendingFrames: pending.size, cancelledFrames };
    } };
  });
}
