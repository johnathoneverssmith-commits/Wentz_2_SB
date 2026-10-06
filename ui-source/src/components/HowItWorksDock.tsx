import { useState } from "react";
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
  const [id, setId] = useState(topics[0]!.id);
  const topic = topics.find((t) => t.id === id) ?? topics[0]!;
  return (
    <div className="how-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="how-drawer" role="dialog" aria-modal="true" aria-label="How it works" ref={ref}>
        <div className="how-head">
          <strong>How it works</strong>
          <button type="button" onClick={onClose} aria-label="Close how it works">
            Close
          </button>
        </div>
        {topics.length > 1 && (
          <div className="how-tabs" role="tablist">
            {topics.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === topic.id}
                className={t.id === topic.id ? "on" : ""}
                onClick={() => setId(t.id)}
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
        <div className="how-body" role="tabpanel">
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
    </div>
  );
}
