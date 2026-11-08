/**
 * In-page measurements. Each probe is a self-contained function run inside the page (no imports, no closures), reads
 * the DOM and computed styles only, and changes nothing. The result of `runProbes` is plain JSON, recorded next to the
 * screenshot so a defect can be traced to a measurement, not an impression.
 */
import type { Page } from "@playwright/test";

export interface Finding {
  rule: string;
  /** A stable signature of the element (tag, role, classes), for grouping repeated root causes. */
  sig: string;
  detail: string;
  /** Rough placement, for the register. */
  text?: string;
  data?: Record<string, number | string | boolean | null>;
}

export interface ProbeResult {
  url: string;
  h1: string[];
  title: string;
  doc: { scrollWidth: number; clientWidth: number; scrollHeight: number; innerHeight: number };
  fonts: { bodyFamily: string; h1Family: string | null; loaded: string[] };
  findings: Finding[];
  counts: { interactive: number; textElements: number; contrastChecked: number; contrastIndeterminate: number };
}

export interface ProbeOptions {
  touch: boolean;
}

export async function runProbes(page: Page, opts: ProbeOptions): Promise<ProbeResult> {
  return page.evaluate((o) => {
    const findings: Finding[] = [];
    const add = (f: Finding): void => {
      if (findings.length < 400) findings.push(f);
    };
    const sigOf = (el: Element): string => {
      const cls = [...el.classList].filter((c) => !/^\d|^css-|^[a-z]{1,2}-[0-9a-f]{5,}/.test(c)).slice(0, 3).join(".");
      const role = el.getAttribute("role");
      return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${cls ? "." + cls : ""}`;
    };
    const visible = (el: Element): boolean => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = getComputedStyle(n);
        if (c.display === "none" || c.visibility === "hidden") return false;
        if (n.getAttribute("aria-hidden") === "true") return false;
      }
      return true;
    };
    const vw = document.documentElement.clientWidth;

    // ---- 1. horizontal overflow: the document, then the elements that cause it
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) {
      add({ rule: "overflow-x-document", sig: "html", detail: `page scrolls sideways: scrollWidth ${de.scrollWidth} > clientWidth ${de.clientWidth}`, data: { over: de.scrollWidth - de.clientWidth } });
      const culprits: Array<{ el: Element; right: number }> = [];
      for (const el of document.body.querySelectorAll("*")) {
        if (!visible(el)) continue;
        // an element inside its own horizontal scroller is not the cause
        let scrolled = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const ox = getComputedStyle(p).overflowX;
          if ((ox === "auto" || ox === "scroll" || ox === "hidden") && p.scrollWidth <= p.clientWidth + 1) {
            const pr = p.getBoundingClientRect();
            if (pr.right <= vw + 1) { scrolled = true; break; }
          }
          if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth) { scrolled = true; break; }
        }
        if (scrolled) continue;
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1) culprits.push({ el, right: r.right });
      }
      culprits.sort((a, b) => b.right - a.right);
      // keep the outermost few: children of a culprit repeat it
      const seen: Element[] = [];
      for (const c of culprits) {
        if (seen.some((s) => s.contains(c.el) || c.el.contains(s))) continue;
        seen.push(c.el);
        add({ rule: "overflow-x-element", sig: sigOf(c.el), detail: `extends to ${Math.round(c.right)}px in a ${vw}px viewport`, text: (c.el.textContent ?? "").trim().slice(0, 60), data: { right: Math.round(c.right), viewport: vw } });
        if (seen.length >= 6) break;
      }
    }

    // ---- 2. clipped text: an element that hides its own overflow while its content is wider/taller than its box
    for (const el of document.body.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      const clipsX = cs.overflowX === "hidden" || cs.overflowX === "clip";
      // a visually-hidden box (sr-only: 1px, clipped) is meant to be that small
      const hiddenOnPurpose = el.clientWidth <= 2 || el.clientHeight <= 2 || cs.clip !== "auto" || cs.clipPath !== "none" || /\bsr-only\b|visually-hidden/.test(el.className?.toString() ?? "");
      if (clipsX && !hiddenOnPurpose && el.scrollWidth > el.clientWidth + 2 && (el.textContent ?? "").trim() && el.children.length < 12) {
        const ellipsis = cs.textOverflow === "ellipsis";
        // an ellipsis is a decision; a silent cut is a defect unless the full text is reachable by title/aria-label
        const reachable = el.hasAttribute("title") || el.hasAttribute("aria-label");
        if (!ellipsis || !reachable) {
          add({ rule: ellipsis ? "text-truncated-no-title" : "text-clipped", sig: sigOf(el), detail: `content ${el.scrollWidth}px in a ${el.clientWidth}px box (${ellipsis ? "ellipsis, no title" : "clipped"})`, text: (el.textContent ?? "").trim().slice(0, 60), data: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } });
        }
      }
    }

    // ---- 3. interactive elements: target size and accessible name
    const interactive = [...document.querySelectorAll<HTMLElement>("a[href], button, [role=button], [role=tab], [role=link], [role=menuitem], [role=radio], [role=checkbox], input:not([type=hidden]), select, textarea, summary")].filter(visible);
    const nameOf = (el: HTMLElement): string => {
      const labelled = el.getAttribute("aria-labelledby");
      if (labelled) return labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      const al = el.getAttribute("aria-label");
      if (al) return al.trim();
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const l = el.labels?.[0]?.textContent;
        if (l) return l.trim();
        if (el instanceof HTMLInputElement && (el.type === "button" || el.type === "submit")) return el.value;
      }
      const img = el.querySelector("img[alt]");
      const txt = (el.textContent ?? "").trim() || (img?.getAttribute("alt") ?? "").trim();
      return txt || (el.getAttribute("title") ?? "").trim();
    };
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      const inline = getComputedStyle(el).display === "inline" && el.tagName === "A";
      const min = Math.min(r.width, r.height);
      // WCAG 2.2 AA 2.5.8: 24 CSS px (inline text links in a sentence are exempt). The product target is 44 on touch widths.
      if (!inline && min < 24) add({ rule: "target-below-24", sig: sigOf(el), detail: `${Math.round(r.width)}x${Math.round(r.height)}px`, text: nameOf(el).slice(0, 40), data: { w: Math.round(r.width), h: Math.round(r.height) } });
      else if (o.touch && !inline && (r.height < 44 || r.width < 44) && !(el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")))
        add({ rule: "target-below-44-touch", sig: sigOf(el), detail: `${Math.round(r.width)}x${Math.round(r.height)}px at a touch width`, text: nameOf(el).slice(0, 40), data: { w: Math.round(r.width), h: Math.round(r.height) } });
      if (!nameOf(el)) add({ rule: "no-accessible-name", sig: sigOf(el), detail: "interactive element with no text, aria-label, label or title", data: { tag: el.tagName } });
    }

    // ---- 4. headings and landmarks
    const h1s = [...document.querySelectorAll("h1")].filter(visible).map((h) => (h.textContent ?? "").trim());
    if (h1s.length !== 1) add({ rule: "h1-count", sig: "h1", detail: `${h1s.length} visible h1 elements (${h1s.map((t) => JSON.stringify(t.slice(0, 40))).join(", ")})`, data: { count: h1s.length } });
    let prev = 0;
    for (const h of document.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      if (!visible(h)) continue;
      const lv = Number(h.tagName[1]);
      if (prev && lv > prev + 1) add({ rule: "heading-skip", sig: sigOf(h), detail: `h${prev} followed by h${lv}`, text: (h.textContent ?? "").trim().slice(0, 40) });
      prev = lv;
    }
    if (!document.querySelector("main, [role=main]")) add({ rule: "no-main-landmark", sig: "body", detail: "no <main> landmark" });
    for (const img of document.querySelectorAll("img")) if (visible(img) && !img.hasAttribute("alt")) add({ rule: "img-no-alt", sig: sigOf(img), detail: img.getAttribute("src") ?? "" });

    // ---- 5. contrast: every element that owns text, against the first opaque background above it
    type RGBA = [number, number, number, number];
    const parse = (c: string): RGBA => {
      const m = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1];
      return [m[0] ?? 0, m[1] ?? 0, m[2] ?? 0, m[3] ?? 1];
    };
    const lin = (v: number): number => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    const lum = (c: RGBA): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const over = (top: RGBA, under: RGBA): RGBA => {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    };
    let checked = 0;
    let indeterminate = 0;
    const textEls: Element[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n.textContent ?? "").trim()) continue;
      const p = n.parentElement;
      if (p && !textEls.includes(p) && visible(p) && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(p.tagName)) textEls.push(p);
    }
    const seenKeys = new Set<string>();
    for (const el of textEls) {
      const cs = getComputedStyle(el);
      // find the backdrop: stack of translucent layers up to the first opaque one; an image/gradient makes it indeterminate
      const layers: RGBA[] = [];
      let image = false;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.backgroundImage !== "none") { image = true; break; }
        const bg = parse(s.backgroundColor);
        if (bg[3] > 0) { layers.push(bg); if (bg[3] >= 1) break; }
      }
      if (image) { indeterminate++; continue; }
      let base: RGBA = [255, 255, 255, 1];
      const top = layers.pop();
      if (top) base = top[3] >= 1 ? top : over(top, [255, 255, 255, 1]);
      while (layers.length) base = over(layers.pop()!, base);
      const fgRaw = parse(cs.color);
      const fg = fgRaw[3] < 1 ? over(fgRaw, base) : fgRaw;
      const l1 = lum(fg), l2 = lum(base);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      checked++;
      const px = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = px >= 24 || (px >= 18.66 && bold);
      const need = large ? 3 : 4.5;
      if (ratio < need) {
        const key = `${sigOf(el)}|${fg.map(Math.round)}|${base.map(Math.round)}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        add({ rule: "contrast", sig: sigOf(el), detail: `${ratio.toFixed(2)}:1, needs ${need}:1 (${px}px ${bold ? "bold" : "regular"}) fg rgb(${fg.slice(0, 3).map(Math.round)}) on rgb(${base.slice(0, 3).map(Math.round)})`, text: (el.textContent ?? "").trim().slice(0, 50), data: { ratio: Number(ratio.toFixed(2)), need, px } });
      }
    }

    // ---- 6. fonts actually in use
    const loaded: string[] = [];
    document.fonts.forEach((f) => { if (f.status === "loaded") loaded.push(`${f.family} ${f.weight}`); });
    const h1el = document.querySelector("h1");

    return {
      url: location.hash || location.pathname,
      h1: h1s,
      title: document.title,
      doc: { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, scrollHeight: de.scrollHeight, innerHeight: window.innerHeight },
      fonts: { bodyFamily: getComputedStyle(document.body).fontFamily, h1Family: h1el ? getComputedStyle(h1el).fontFamily : null, loaded: [...new Set(loaded)].slice(0, 20) },
      findings,
      counts: { interactive: interactive.length, textElements: textEls.length, contrastChecked: checked, contrastIndeterminate: indeterminate },
    } satisfies ProbeResult;
  }, opts);
}

/** Findings that fail the audit outright (as opposed to advisories the register records at a lower severity). */
export const HARD_RULES: ReadonlySet<string> = new Set(["overflow-x-document", "no-accessible-name", "h1-count", "contrast", "target-below-24", "text-clipped"]);

// ---- keyboard ---------------------------------------------------------------------------------------------------

export interface FocusStop {
  index: number;
  sig: string;
  name: string;
  visibleRing: boolean;
  inViewport: boolean;
  /** The element's rendered size, for the target rule. */
  w: number;
  h: number;
}

export interface FocusWalk {
  stops: FocusStop[];
  /** Focus left the document (fine, once) or fell back to <body> mid-walk (a focus loss). */
  lostToBody: number;
  /** The same element focused twice in a row: a trap or a stuck handler. */
  repeats: number;
  cycled: boolean;
}

/**
 * Tabs through the page and describes every stop. A focus ring counts as visible when the focused element draws an
 * outline, or its box-shadow / border / background / text decoration differs from the same element unfocused.
 */
export async function walkFocus(page: Page, maxStops = 80): Promise<FocusWalk> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: FocusStop[] = [];
  let lostToBody = 0;
  let repeats = 0;
  let cycled = false;
  let lastKey = "";
  const first: string[] = [];
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return null;
      const snap = (e: HTMLElement) => {
        const s = getComputedStyle(e);
        return `${s.outlineStyle}|${s.outlineWidth}|${s.outlineColor}|${s.boxShadow}|${s.borderColor}|${s.backgroundColor}|${s.textDecorationLine}|${s.color}`;
      };
      const focused = snap(el);
      const s = getComputedStyle(el);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      // compare with the unfocused look by blurring for one measurement
      el.blur();
      const plain = snap(el);
      el.focus({ preventScroll: true });
      const r = el.getBoundingClientRect();
      const cls = [...el.classList].slice(0, 3).join(".");
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("title") ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
      return {
        sig: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`,
        name,
        visibleRing: outline || focused !== plain,
        inViewport: r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
    if (!stop) {
      // focus left the page's controls. At the end of the tab ring that is normal (the browser's own UI takes it, and the
      // next Tab wraps to the first stop); anywhere else it is a loss. Press once more to tell which.
      await page.keyboard.press("Tab");
      const resumed = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el && el !== document.body ? `${el.tagName.toLowerCase()}|${(el.textContent ?? "").trim().slice(0, 30)}` : null;
      });
      const firstStop = stops[0] ? `${stops[0].sig.split(".")[0]}|` : "";
      if (resumed && resumed.startsWith(firstStop)) { cycled = true; break; } // wrapped to the top: the ring is complete
      lostToBody++;
      if (lostToBody > 2) break;
      continue;
    }
    const key = `${stop.sig}|${stop.name}|${stop.w}x${stop.h}`;
    if (key === lastKey) repeats++;
    lastKey = key;
    if (first.includes(key) && i > 3) { cycled = true; break; }
    if (i < 3) first.push(key);
    stops.push({ index: i, ...stop });
  }
  return { stops, lostToBody, repeats, cycled };
}

// ---- motion -----------------------------------------------------------------------------------------------------

/** Running animations and transitions at this moment, excluding ones that have already finished. */
export async function runningMotion(page: Page): Promise<Array<{ name: string; target: string; iterations: number | string; durationMs: number }>> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const t = a.effect?.getTiming();
        const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return {
          name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id ?? "animation",
          target: target ? `${target.tagName.toLowerCase()}${target.className && typeof target.className === "string" ? "." + target.className.split(/\s+/).slice(0, 2).join(".") : ""}` : "?",
          iterations: t?.iterations === Infinity ? "infinite" : (t?.iterations ?? 1),
          durationMs: Number(t?.duration ?? 0),
        };
      }),
  );
}
