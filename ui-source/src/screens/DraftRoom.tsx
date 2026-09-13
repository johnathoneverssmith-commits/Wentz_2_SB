import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { FullScreenOverlay } from "@/components/FullScreenOverlay";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { RosterNeeds } from "@/components/RosterNeeds";
import { TEAMS_BY_CODE } from "@/data/teams";
import { POSITIONS, type DraftMode, type Position } from "@/domain";
import { bestAvailable, useStore } from "@/state/store";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { ordinal } from "@/util/format";

interface Available {
  id: string;
  name: string;
  position: Position;
  age: number;
  ovr: number;
  proj: string;
  sub: string;
}

export function DraftRoom() {
  const nav = useNavigate();
  const s = useStore();
  const { active, setActive } = useTabs("available");
  const [posFilter, setPosFilter] = useState<"ALL" | Position>("ALL");
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  const code = viewerTeamCode(s);
  const startDraft = useStore((st) => st.startDraft);
  const makePick = useStore((st) => st.makePick);
  const autopick = useStore((st) => st.autopickRemaining);
  const tryAdvance = useStore((st) => st.tryAdvance);
  const setReady = useStore((st) => st.setReady);
  const autoReady = useStore((st) => st.autoReadyNonViewers);

  const isDraftStage = s.stage === "fantasyDraft" || s.stage === "offseasonDraft";
  const mode: DraftMode = s.stage === "fantasyDraft" ? "fantasy" : "rookie";

  useEffect(() => {
    if (isDraftStage && (!s.draft || s.draft.mode !== mode)) startDraft(mode);
  }, [isDraftStage, s.draft, mode, startDraft]);

  const draft = s.draft;
  const taken = useMemo(() => new Set(draft?.results.map((r) => r.selectedId) ?? []), [draft]);
  const onClockTeam = draft ? draft.pickOrder[draft.currentPickIndex] : undefined;
  const yourPick = onClockTeam === code;
  const complete = draft ? draft.currentPickIndex >= draft.pickOrder.length : false;

  // the whole board, best first — filtered *before* the display slice so a
  // position filter can always reach every player at that position (a K/P
  // would otherwise never appear in the top 100 by overall)
  const available = useMemo<Available[]>(() => {
    if (!draft) return [];
    if (mode === "rookie") {
      return s.draftClass
        .filter((p) => !taken.has(p.id))
        .sort((a, b) => b.collegeOverall - a.collegeOverall)
        .map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          age: p.age,
          ovr: p.collegeOverall,
          proj: p.projectedRange,
          sub: `${p.school} · ${p.classYear}`,
        }));
    }
    return Object.values(s.players)
      .filter((p) => !taken.has(p.id) && !p.retired)
      .sort((a, b) => b.overall - a.overall)
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        age: p.age,
        ovr: p.overall,
        proj: ordinal(i + 1),
        sub: TEAMS_BY_CODE[p.nfl_team]?.city ?? "Free agent",
      }));
  }, [draft, mode, s.players, s.draftClass, taken]);

  const filtered = useMemo(
    () => available.filter((p) => posFilter === "ALL" || p.position === posFilter).slice(0, 100),
    [available, posFilter],
  );

  // AI auto-picks when it's not your turn
  useEffect(() => {
    if (!draft || complete || yourPick) return;
    const t = setTimeout(() => {
      const best = available[0];
      if (best) makePick(best.id);
    }, 200);
    return () => clearTimeout(t);
  }, [draft, complete, yourPick, available, makePick]);

  useEffect(() => {
    if (complete) {
      const t = setTimeout(() => autoReady(), 700);
      return () => clearTimeout(t);
    }
  }, [complete, autoReady]);

  // reset the on-the-clock overlay each time it becomes your pick
  useEffect(() => {
    if (yourPick) setOverlayDismissed(false);
  }, [yourPick, draft?.currentPickIndex]);

  if (!draft) {
    return (
      <Card>
        <CardHeader badge="FS" title="Draft Room" subtitle="Setting up…" />
        <div className="panel open">
          <div className="emptystate">Building the draft board…</div>
        </div>
      </Card>
    );
  }

  const round = Math.floor(draft.currentPickIndex / draft.pickOrder.length * (mode === "fantasy" ? 20 : 7)) + 1;
  const maxRounds = mode === "fantasy" ? 20 : 7;
  const myResults = draft.results.filter((r) => r.teamCode === code);
  // in a fantasy draft every roster is being rebuilt from the pool, so the
  // only players that count are the ones drafted so far — not whoever still
  // carries this team's code from the pre-draft pool
  const myRoster = !code
    ? []
    : mode === "fantasy"
      ? myResults.map((r) => s.players[r.selectedId ?? ""]).filter((p): p is NonNullable<typeof p> => !!p)
      : teamRoster(s, code);
  // the same need-weighted pick the AI would make for this roster, offered
  // as a one-click suggestion whenever it's the viewer's turn
  const suggestedId = yourPick && !complete ? bestAvailable(s) : null;
  const suggested = suggestedId ? available.find((a) => a.id === suggestedId) : undefined;

  return (
    <Card maxWidth={860}>
      {yourPick && !complete && !overlayDismissed && (
        <FullScreenOverlay
          kicker="On the clock"
          big={`The ${TEAMS_BY_CODE[code!]!.city} ${TEAMS_BY_CODE[code!]!.name} are on the clock`}
          note="Click anywhere to make your selection."
          onDismiss={() => setOverlayDismissed(true)}
        />
      )}

      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Draft Room"
        subtitle={`${draft.year} ${mode === "fantasy" ? "Fantasy Draft" : "Rookie Draft"} · Round ${Math.min(round, maxRounds)} · ${cap(draft.order)}`}
      />
      <Ticker
        stats={[
          {
            label: "On the clock",
            value: complete ? "Complete" : onClockTeam ? TEAMS_BY_CODE[onClockTeam]!.city : "—",
            className: yourPick ? "accent" : undefined,
          },
          { label: "Pick", value: `${Math.min(draft.currentPickIndex + 1, draft.pickOrder.length)} / ${draft.pickOrder.length}`, className: "sm" },
          { label: "Your picks", value: myResults.length },
          { label: "Roster", value: myRoster.length },
        ]}
      />
      <Tabs
        tabs={[
          { id: "available", label: mode === "fantasy" ? "Available Players" : "Available Prospects" },
          { id: "mine", label: "Your Players" },
          { id: "needs", label: "Team Needs" },
          { id: "board", label: "League Draft Board" },
        ]}
        active={active}
        onChange={setActive}
      />

      {active !== "needs" && (
        <div style={{ padding: "12px 26px 0", display: "flex", alignItems: "center", gap: 9 }}>
          <label style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>Position</label>
          <select value={posFilter} onChange={(e) => setPosFilter(e.target.value as "ALL" | Position)}>
            <option value="ALL">All positions</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      )}

      <Panel open={active === "available"}>
        {yourPick && !complete && (
          <div
            className="team-callout"
            style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
            role="status"
          >
            <span style={{ flex: 1, minWidth: 200 }}>
              You're on the clock
              {suggested ? (
                <>
                  {" "}
                  — best fit for your roster:{" "}
                  <strong style={{ color: "var(--ink)" }}>{suggested.name}</strong>{" "}
                  <span style={{ color: "var(--ink-dim)", fontWeight: 500 }}>
                    ({suggested.position}, {suggested.ovr} OVR)
                  </span>
                </>
              ) : (
                " — make your selection."
              )}
            </span>
            {suggested && (
              <button
                className="btn-primary"
                style={{ fontSize: 11.5, padding: "7px 12px" }}
                onClick={() => makePick(suggested.id)}
              >
                Draft {suggested.name}
              </button>
            )}
          </div>
        )}
        {filtered.length === 0 && (
          <div className="emptystate" style={{ marginBottom: 12 }}>
            No {posFilter === "ALL" ? "players" : posFilter} left on the board.
          </div>
        )}
        <div style={{ overflowX: "auto", maxHeight: 460, overflowY: "auto" }}>
          <table className="stbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="c">Pos</th>
                <th className="c">OVR</th>
                <th className="c">Age</th>
                <th className="c">Projected</th>
                <th className="r"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="name">
                    {p.name}
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)" }}>{p.sub}</span>
                  </td>
                  <td className="c">{p.position}</td>
                  <td className="c">
                    <OvrPill value={p.ovr} />
                  </td>
                  <td className="c">{p.age}</td>
                  <td className="c" style={{ fontSize: 11.5 }}>{p.proj}</td>
                  <td className="r">
                    <button
                      className="btn-primary"
                      style={{ fontSize: 11, padding: "6px 10px" }}
                      disabled={!yourPick || complete}
                      onClick={() => makePick(p.id)}
                    >
                      Draft
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel open={active === "mine"}>
        {myResults.length === 0 ? (
          <div className="emptystate">You haven't drafted anyone yet.</div>
        ) : (
          <table className="stbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="c">Pos</th>
                <th className="c">Age</th>
                <th className="c">Round · Pick</th>
                <th className="c">OVR</th>
              </tr>
            </thead>
            <tbody>
              {myResults.map((r) => {
                const p = mode === "fantasy" ? s.players[r.selectedId ?? ""] : undefined;
                const pr = mode === "rookie" ? s.draftClass.find((d) => d.id === r.selectedId) : undefined;
                const ovr = p?.overall ?? pr?.collegeOverall ?? "—";
                const age = p?.age ?? pr?.age ?? "—";
                return (
                  <tr key={r.pickNumber}>
                    <td className="name">{r.selectedName}</td>
                    <td className="c">{r.selectedPosition}</td>
                    <td className="c">{age}</td>
                    <td className="c">
                      R{r.round} · #{r.pickNumber}
                    </td>
                    <td className="c">{ovr}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel open={active === "needs"}>
        {code ? (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-faint)" }}>
              Numerator = players you've secured at the group · denominator = roster minimum. Red = still short.
            </p>
            <RosterNeeds roster={myRoster} />
          </>
        ) : (
          <div className="emptystate">Pick a team first.</div>
        )}
      </Panel>

      <Panel open={active === "board"}>
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          {[...draft.results]
            .reverse()
            .filter((r) => posFilter === "ALL" || r.selectedPosition === posFilter)
            .slice(0, 60)
            .map((r) => (
              <div key={r.pickNumber} style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr", alignItems: "center", gap: 12, padding: "10px 6px", borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>#{r.pickNumber}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500 }}>
                  <TeamBadge code={r.teamCode} size={18} />
                  {TEAMS_BY_CODE[r.teamCode]?.city ?? r.teamCode}
                </span>
                <span style={{ fontSize: 12.5, textAlign: "right", color: "var(--ink)" }}>
                  {r.selectedName} · {r.selectedPosition}
                </span>
              </div>
            ))}
          {draft.results.length === 0 && <div className="emptystate">No picks yet.</div>}
        </div>
      </Panel>

      <Footer>
        {!complete ? (
          <button onClick={() => autopick()}>Autopick remaining</button>
        ) : (
          <button
            className="btn-primary"
            onClick={() => {
              setReady(s.viewerGmId, true);
              autoReady();
              setTimeout(async () => {
                const { moved, route } = await tryAdvance();
                if (moved) nav(route);
              }, 300);
            }}
          >
            {mode === "fantasy" ? "Continue to draft summary" : "Continue to signings"}
          </button>
        )}
      </Footer>
    </Card>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
