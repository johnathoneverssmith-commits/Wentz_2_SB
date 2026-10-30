import { createPortal } from "react-dom";
import { Tabs } from "./primitives";
import { quickGuide } from "./journey/guidance";
import { useStore } from "@/state/store";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

import { useDialog } from "@/components/useDialog";
import { type HowTopic, topicsFor } from "@/state/howItWorks";

/**
 * "How it works" on every screen that has a system behind it: a tab on the
 * edge of the screen that opens the rules in plain language over whatever you
 * are doing, without leaving it. The text lives in `state/howItWorks.ts`, and
 * changes in the same commit as the mechanic it describes.
 */
export function HowItWorksDock() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const topics = topicsFor(pathname);
  useEffect(() => setOpen(false), [pathname]);
  if (topics.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className="how-tab"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        How it works
      </button>
      {open && <Drawer topics={topics} onClose={() => setOpen(false)} />}
    </>
  );
}

function Drawer({ topics, onClose }: { topics: HowTopic[]; onClose: () => void }) {
  const ref = useDialog(onClose);
  const s = useStore();
  const {pathname} = useLocation();
  const tips = quickGuide(pathname,s);
  const [id, setId] = useState(topics[0]!.id);
  const topic = topics.find((t) => t.id === id) ?? topics[0]!;
  return createPortal(
    <div className="how-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="how-drawer" role="dialog" aria-modal="true" aria-label="How it works" ref={ref}>
        <div className="how-head">
          <strong>How it works</strong>
          <button type="button" onClick={onClose} aria-label="Close how it works">
            Close
          </button>
        </div>
        {topics.length > 1 && (
          <Tabs tabs={topics.map(t=>({id:t.id,label:t.title}))} active={topic.id} onChange={setId} group="how" label="Rules topics" />
        )}
        {topics.filter(t=>t.id!==topic.id).map(t=><div key={t.id} id={`how-panel-${t.id}`} role="tabpanel" aria-labelledby={`how-tab-${t.id}`} hidden/>)}
        <div className="how-body" role="tabpanel" id={`how-panel-${topic.id}`} aria-labelledby={topics.length>1?`how-tab-${topic.id}`:undefined} aria-label={topics.length===1?topic.title:undefined}>
          <section className="how-quick" aria-label="Quick guidance"><h2>Start here</h2><ul>{tips.map(t=><li key={t}>{t}</li>)}</ul></section>
          <h2 className="oswald" style={{ margin: "0 0 4px", fontSize: 24 }}>
            {topic.title}
          </h2>
          <p style={{ margin: "0 0 14px", color: "var(--ink-dim)", fontSize: 13.5 }}>{topic.summary}</p>
          {topic.sections.map((sec) => (
            <section key={sec.heading} style={{ marginBottom: 16 }}>
              <h3 style={{ margin: "0 0 6px", fontSize: 14.5 }}>{sec.heading}</h3>
              {sec.body.map((p, i) => (
                <p key={i} style={{ margin: "0 0 8px", fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-dim)" }}>
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
