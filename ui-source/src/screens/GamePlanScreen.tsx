import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card, CardHeader, Footer } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import { cleanPlan, DEFAULT_PLAN, type GamePlan, isDefaultPlan } from "@/state/gamePlan";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

/** What each personnel group is, for the labels. */
const PERSONNEL: { key: "p11" | "p12" | "p13"; label: string; note: string }[] = [
  { key: "p11", label: "11 personnel", note: "one back, one tight end, three receivers" },
  { key: "p12", label: "12 personnel", note: "one back, two tight ends, two receivers" },
  { key: "p13", label: "13 personnel", note: "one back, three tight ends, one receiver" },
];

const signed = (n: number, unit = ""): string => (n > 0 ? `+${n}${unit}` : n < 0 ? `−${Math.abs(n)}${unit}` : `0${unit}`);

/** Raises one share of the mix and takes the difference from the other two, in proportion, so it always sums to 100. */
function setMix(plan: GamePlan, key: "p11" | "p12" | "p13", value: number): GamePlan {
  const others = (["p11", "p12", "p13"] as const).filter((k) => k !== key);
  const rest = 100 - value;
  const have = others.reduce((n, k) => n + plan[k], 0);
  const next = { ...plan, [key]: value } as GamePlan;
  others.forEach((k, i) => {
    next[k] = have > 0 ? Math.round((plan[k] / have) * rest) : Math.round(rest / 2);
    if (i === others.length - 1) next[k] = rest - next[others[0]!];
  });
  return next;
}

function Dial({
  label,
  value,
  min,
  max,
  onChange,
  display,
  low,
  high,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  display: string;
  low: string;
  high: string;
  note: string;
}) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <label style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</label>
        <span className="oswald" style={{ marginLeft: "auto", fontSize: 15, color: value === 0 || display.startsWith("0") ? "var(--ink-dim)" : "var(--team)" }}>
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", margin: "8px 0 2px", accentColor: "var(--team)" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-faint)" }}>
        <span>{low}</span>
        <span>{high}</span>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--ink-dim)", lineHeight: 1.5 }}>{note}</p>
    </div>
  );
}

function Group({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 18 }}>
      <p className="sectionlabel" style={{ margin: "0 0 2px" }}>
        {title}
      </p>
      <p style={{ margin: "0 0 4px", fontSize: 11.5, color: "var(--ink-faint)" }}>{blurb}</p>
      {children}
    </section>
  );
}

/**
 * The game plan: the dials a coach sets before a set of games. Saved on the
 * GM's team and read by the engine for every game it simulates from then on;
 * games already played aren't touched. A default plan is the engine as it
 * always was, so a GM who never opens this plays exactly as before.
 */
export function GamePlanScreen() {
  const nav = useNavigate();
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const saved = useMemo(() => cleanPlan(code ? s.gamePlans?.[code] : undefined), [s.gamePlans, code]);
  const [plan, setPlan] = useState<GamePlan>(saved);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // pick up a plan saved elsewhere (another device, online) when nothing is being edited
  useEffect(() => setPlan(saved), [saved]);
  const dirty = JSON.stringify(plan) !== JSON.stringify(saved);
  const set = (patch: Partial<GamePlan>) => {
    setNote(null);
    setPlan((p) => cleanPlan({ ...p, ...patch }));
  };

  if (!code) {
    return (
      <Card maxWidth={800}>
        <CardHeader badge="FS" title="Game Plan" subtitle="No team selected" />
        <div className="emptystate">Pick a team in League Setup first.</div>
      </Card>
    );
  }
  const meta = TEAMS_BY_CODE[code]!;
  const fourthNote = (zone: string) =>
    `Higher means more fourth downs ${zone} are gone for rather than punted or kicked. It never applies in the final two minutes, where the clock decides.`;

  return (
    <Card maxWidth={800}>
      <CardHeader badge={meta.abbr} title="Game Plan" subtitle={`${meta.label} · applies to games not yet simulated`} />
      <div style={{ padding: "6px 22px 4px" }}>
        <Group title="Pass or run" blurb="How the offense calls its game.">
          <Dial
            label="Pass rate"
            value={plan.passRate}
            min={-15}
            max={15}
            onChange={(n) => set({ passRate: n })}
            display={signed(plan.passRate, " pts")}
            low="more runs"
            high="more passes"
            note="Points added to or taken off the share of plays that are passes. More throws means more yards a play and more sacks and interceptions; more runs shortens the game and keeps the defense honest."
          />
        </Group>

        <Group title="Fourth down" blurb="Going for it, by where the ball is. None of these applies in the last two minutes.">
          <Dial
            label="Opponent's red zone"
            value={plan.fourthRedZone}
            min={-100}
            max={100}
            onChange={(n) => set({ fourthRedZone: n })}
            display={signed(plan.fourthRedZone)}
            low="always kick"
            high="always go"
            note={fourthNote("inside the opponent's 20")}
          />
          <Dial
            label="Opponent's territory"
            value={plan.fourthOpp}
            min={-100}
            max={100}
            onChange={(n) => set({ fourthOpp: n })}
            display={signed(plan.fourthOpp)}
            low="always kick"
            high="always go"
            note={fourthNote("between the opponent's 20 and midfield")}
          />
          <Dial
            label="Own territory"
            value={plan.fourthOwn}
            min={-100}
            max={100}
            onChange={(n) => set({ fourthOwn: n })}
            display={signed(plan.fourthOwn)}
            low="always punt"
            high="always go"
            note={fourthNote("in your own half")}
          />
        </Group>

        <Group title="Defense" blurb="What the defense sends.">
          <Dial
            label="Blitz rate"
            value={plan.blitz}
            min={-100}
            max={100}
            onChange={(n) => set({ blitz: n })}
            display={signed(plan.blitz)}
            low="sit back"
            high="send the house"
            note="More blitzing gets home more often and costs you when it's picked up: the big play behind it. It works best with corners who can hold up alone, and worst against a great quarterback behind a great line."
          />
        </Group>

        <Group title="Personnel" blurb="How often the offense lines up each way. The three always add to 100.">
          {PERSONNEL.map((p) => (
            <Dial
              key={p.key}
              label={`${p.label}: ${p.note}`}
              value={plan[p.key]}
              min={0}
              max={100}
              onChange={(n) => {
                setNote(null);
                setPlan((cur) => cleanPlan(setMix(cur, p.key, n)));
              }}
              display={`${plan[p.key]}%`}
              low="never"
              high="every snap"
              note={
                p.key === "p11"
                  ? "The spread look: the most receivers, the most completions, the least help for the run."
                  : p.key === "p12"
                    ? "A second tight end blocks for the run and the passer, and takes a receiver off the field."
                    : "The heavy package: the best run blocking and the least passing game."
              }
            />
          ))}
        </Group>

        <Group title="Running backs" blurb="Who carries it.">
          <Dial
            label="Second back's share of runs"
            value={plan.rbCommittee}
            min={0}
            max={50}
            onChange={(n) => set({ rbCommittee: n })}
            display={`${plan.rbCommittee}%`}
            low="one workhorse"
            high="even committee"
            note="A back who shares the work is fresher, but the one behind him is usually worse. Your lead back's numbers rise when he carries more, and your second back's when he does."
          />
        </Group>
      </div>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          {note ?? (isDefaultPlan(plan) ? "This is the standard plan: the game as it's always been played." : dirty ? "Unsaved changes." : "Saved. It applies to every game from the next one simulated.")}
        </span>
        <button type="button" disabled={isDefaultPlan(plan)} onClick={() => setPlan(cleanPlan(DEFAULT_PLAN))}>
          Reset to standard
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!dirty || busy}
          onClick={() => {
            setBusy(true);
            void actions
              .saveGamePlan(plan)
              .then((r) => setNote(r.ok ? "Saved. It applies to every game from the next one simulated." : (r.reason ?? "Couldn't save the plan.")))
              .finally(() => setBusy(false));
          }}
        >
          Save plan
        </button>
        <button type="button" onClick={() => nav("/hub")}>
          Back to hub
        </button>
      </Footer>
    </Card>
  );
}
