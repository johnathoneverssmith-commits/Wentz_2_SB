import { AI_STRATEGY_IDENTITY, prioritizedPositions, AI_SEASON_STRATEGIES, type AiSeasonStrategy } from "@/state/aiStrategy";
import { posLabel } from "@/util/format";
import { useStore } from "@/state/store";

/**
 * Who runs a team and what they prioritize: the GM's name and identity.
 * A CPU GM's identity is public, because it is why their roster looks the
 * way it does. A person's is theirs alone, so another human's team reads
 * "Human GM" and your own shows the one you picked.
 */
function useGm(code: string) {
  const ai = useStore((s) => s.aiGms?.find((g) => g.teamCode === code));
  const human = useStore((s) => s.gms.find((g) => g.isHuman && g.teamCode === code));
  const viewer = useStore((s) => s.viewerGmId);
  if (human) {
    const mine = human.id === viewer;
    return { name: human.name, human: true as const, strategy: mine ? (human.strategy ?? "balanced") : null, mine };
  }
  if (ai) return { name: ai.name, human: false as const, strategy: ai.strategy, mine: false };
  return null;
}

/** One line: "Casey Marsh · Trenches first". */
export function GmLine({ code, style }: { code: string; style?: React.CSSProperties }) {
  const gm = useGm(code);
  if (!gm) return null;
  const id = gm.strategy ? AI_STRATEGY_IDENTITY[gm.strategy] : null;
  const title = id ? `${gm.name}: ${id.headline}` : `${gm.name} is a human GM`;
  return (
    <span className="gmline" title={title} style={{ fontSize: 11, color: "var(--ink-dim)", ...style }}>
      <b style={{ fontWeight: 600 }}>{gm.mine ? `${gm.name} (you)` : gm.name}</b>
      {" · "}
      {id ? id.label : "Human GM"}
    </span>
  );
}

/** The longer version, for the trade window and the matchup tab: name, what they prioritize, where it shows. */
export function GmCard({ code }: { code: string }) {
  const gm = useGm(code);
  if (!gm) return null;
  const id = gm.strategy ? AI_STRATEGY_IDENTITY[gm.strategy] : null;
  const pays = gm.strategy ? prioritizedPositions(gm.strategy) : [];
  return (
    <div
      className="gmcard"
      style={{ padding: "8px 11px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", background: "var(--panel-sunken)", fontSize: 12 }}
    >
      <p style={{ margin: 0, fontSize: 10.5, letterSpacing: "0.08em", color: "var(--ink-faint)", textTransform: "uppercase" }}>GM identity</p>
      <p style={{ margin: "2px 0 0", fontWeight: 600 }}>
        {gm.mine ? `${gm.name} (you)` : gm.name}
        <span style={{ fontWeight: 400, color: "var(--ink-dim)" }}> · {id ? id.label : "Human GM"}</span>
      </p>
      {id && <p style={{ margin: "3px 0 0", color: "var(--ink-dim)" }}>{id.headline}</p>}
      {pays.length > 0 && (
        <p style={{ margin: "3px 0 0", color: "var(--ink-faint)" }}>Pays up for: {pays.map((p) => posLabel(p)).join(", ")}</p>
      )}
    </div>
  );
}

/** The picker on the setup screen: a person's identity, chosen before the draft. */
export function GmIdentityPicker({
  value,
  onChange,
  disabled,
}: {
  value: AiSeasonStrategy;
  onChange: (s: AiSeasonStrategy) => void;
  disabled?: boolean;
}) {
  const id = AI_STRATEGY_IDENTITY[value];
  const pays = prioritizedPositions(value);
  return (
    <div style={{ margin: "14px 0 6px" }}>
      <p className="sectionlabel" style={{ margin: "0 0 6px" }}>
        GM identity
      </p>
      <select
        aria-label="GM identity"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as AiSeasonStrategy)}
        style={{ minWidth: 240 }}
      >
        {AI_SEASON_STRATEGIES.map((k) => (
          <option key={k} value={k}>
            {AI_STRATEGY_IDENTITY[k].label}
          </option>
        ))}
      </select>
      <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink-dim)" }}>
        {id.headline}
        {pays.length > 0 ? ` (${pays.map((p) => posLabel(p)).join(", ")})` : ""}.
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
        Your auto-picks in the fantasy draft and the rest of the offseason, and what your staff signs and proposes for you, lean this way. It is a
        preference, not a promise: it breaks ties between similar players and never takes a clearly worse one. Other GMs can&apos;t see it, and
        it is locked once the league starts.
      </p>
    </div>
  );
}
