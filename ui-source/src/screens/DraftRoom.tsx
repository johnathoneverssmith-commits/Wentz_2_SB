import { useEffect, useMemo, useRef, useState } from "react";
import { projectedRookieRange } from "@/sim/draft-outcomes";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { FullScreenOverlay } from "@/components/FullScreenOverlay";
import { useListFilter } from "@/components/ListFilter";
import { PlayerStatsModal } from "@/components/PlayerStatsModal";
import { useLeagueActions } from "@/state/useLeagueActions";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { FitTag } from "@/components/FitTag";
import { RosterNeeds } from "@/components/RosterNeeds";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { DraftMode, Player, Position } from "@/domain";
import { draftTargetsFor } from "@/state/rules";
import { bestAvailable, draftValue, picksMadeBy, useStore } from "@/state/store";
import { STAGE_HOME } from "@/state/stageMachine";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { fitFor } from "@/state/unitReport";

interface Available {
  id: string;
  name: string;
  position: Position;
  age: number;
  ovr: number;
  sub: string;
}

export function DraftRoom() {
  const s = useStore();
  const nav = useNavigate();
  const { active, setActive } = useTabs("available");
  const [overlayDismissed, setOverlayDismissed] = useState(false);
  const [inspect, setInspect] = useState<Player | null>(null);
  // one pick in flight at a time: on a slow connection a second click used
  // to send a second pick, and a refused one said nothing at all
  // (the ref, because state lags: two clicks before a re-render both passed)
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const pick = (id: string): void => {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    setPickError(null);
    void actions
      .makeDraftPick(id)
      .then((r) => {
        if (!r.ok) setPickError(r.reason ?? "That pick didn't go through.");
      })
      .finally(() => {
        pickingRef.current = false;
        setPicking(false);
      });
  };

  const code = viewerTeamCode(s);
  // what each prospect would add to your starting units (public grades only)
  const fit = useMemo(() => (code ? fitFor({ players: s.players }, code) : null), [s.players, code]);
  const startDraft = useStore((st) => st.startDraft);
  const actions = useLeagueActions();
  const autoReady = useStore((st) => st.autoReadyNonViewers);

  const isDraftStage = s.stage === "fantasyDraft" || s.stage === "offseasonDraft";
  /**
   * Which draft this stage *wants*. Only the start effect below should use
   * it: it is the thing a stale board is compared against.
   */
  const stageMode: DraftMode = s.stage === "fantasyDraft" ? "fantasy" : "rookie";
  /**
   * Which draft is actually on the screen, which is what every label and the
   * board itself have to follow.
   *
   * These two part company for exactly as long as the "draft complete"
   * overlay is up. Completing the board advances the stage from inside
   * `makePick`, but the overlay deliberately keeps the player here until they
   * press it — so the stage already reads `fantasyDraftSummary` while the
   * fantasy draft is still the thing being looked at. Deriving the labels
   * from the stage meant the last thing you saw after your own fantasy draft
   * was a header reading "2026 Rookie Draft", an "Available Prospects" tab,
   * and a board of college juniors.
   */
  const mode: DraftMode = s.draft?.mode ?? stageMode;

  useEffect(() => {
    // Online the draft belongs to the server: it is made when the stage opens,
    // and arrives with the league. Making one here would be this client
    // inventing its own board — a different order per GM, and picks the server
    // would refuse because they are against a draft only this browser can see.
    if (actions.online) return;
    if (isDraftStage && (!s.draft || s.draft.mode !== stageMode)) startDraft(stageMode);
  }, [isDraftStage, s.draft, stageMode, startDraft, actions.online]);

  // No draft and no draft stage: this is a stale link or a reload ahead of
  // the league (online the board only exists once the server opens the
  // stage). "Setting up…" would sit there forever — go where the league is.
  useEffect(() => {
    if (!s.draft && !isDraftStage) nav(STAGE_HOME[s.stage], { replace: true });
  }, [s.draft, isDraftStage, s.stage, nav]);

  // Reaching the manual-pick threshold completes the board and advances the
  // stage from inside `makePick` itself. That used to double as the exit —
  // this screen silently navigated itself away the instant the stage moved,
  // which fixed the old "no functional exit" deadlock but replaced it with a
  // teleport: the player never saw the board finish. Playtest finding 1a asks
  // for an explicit moment to leave instead, so the stage change now just
  // reveals a "draft complete" overlay (below) rather than triggering nav().

  const draft = s.draft;
  const taken = useMemo(() => new Set(draft?.results.map((r) => r.selectedId) ?? []), [draft]);
  const onClockTeam = draft ? draft.pickOrder[draft.currentPickIndex] : undefined;
  const yourPick = onClockTeam === code;
  const complete = draft ? draft.currentPickIndex >= draft.pickOrder.length : false;
  // how much hand-drafting this GM still owes before the board finishes itself
  const threshold = s.config.draftSimulateAfterPicks;
  const picksLeftForYou =
    threshold == null || !code ? 0 : Math.max(0, threshold - picksMadeBy(s, code));

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
          // what he projects to as a rookie — the college grade runs well
          // above it, and a late-rounder's range is far wider than a top pick's
          sub: (() => {
            const [lo, hi] = projectedRookieRange(p);
            return `${p.school} · ${p.classYear} · projects ${lo}–${hi} as a rookie`;
          })(),
        }));
    }
    // everyone on a fantasy board is unsigned, so "Free agent" under every
    // name said nothing; where he ranks at his position on the board does
    const atPosition = new Map<string, number>();
    return (
      Object.values(s.players)
        .filter((p) => !taken.has(p.id) && !p.retired)
        // Ordered the way the league values players, not by raw overall.
        // Sorting on `overall` alone put a 95 kicker at the top of a 640-pick
        // board, level with Lamar Jackson and Micah Parsons, while the app's
        // own evaluator — the "best fit for your roster" suggestion right
        // above this table — correctly had the quarterback first. That is the
        // same complaint that got the old "Projected" column deleted: its
        // ranking was "based on overall rating rather than position-adjusted
        // value". The column went; the list behind it kept doing it.
        // `draftValue` is the positional premium the CPU drafts on (QB +10,
        // EDGE +8 … K and P -14), so the board now reads like a board.
        .sort((a, b) => draftValue(b.overall, b.position) - draftValue(a.overall, a.position))
        .map((p) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          age: p.age,
          ovr: p.overall,
          sub:
            TEAMS_BY_CODE[p.nfl_team]?.label ??
            (() => {
              const n = (atPosition.get(p.position) ?? 0) + 1;
              atPosition.set(p.position, n);
              return `${p.position}${n} on the board`;
            })(),
        }))
    );
  }, [draft, mode, s.players, s.draftClass, taken]);

  // One control set for the board: a name search as well as a position, and
  // the same `position` drives the league draft board tab below.
  // "Best fit" orders the board by what each player adds to your starting
  // units — the same sort the free-agency board offers
  const [sortBy, setSortBy] = useState<"board" | "fit">("board");
  const sorted = useMemo<Available[]>(() => {
    if (sortBy !== "fit" || !fit) return available;
    const gain = new Map(available.map((p) => [p.id, fit(p.position, p.ovr).gain]));
    return [...available].sort((a, b) => gain.get(b.id)! - gain.get(a.id)!);
  }, [available, sortBy, fit]);
  const market = useListFilter<Available>(sorted, 100);
  const filtered = market.shown;
  const posFilter = market.position;

  // AI picks are no longer driven from here. `startDraft` sweeps the board
  // up to the first pick a human owes, and `makePick` sweeps again after
  // every human pick — both server-side online, both in the store locally
  // (the same `runAiPicks`, which is need/strategy/difficulty-aware). A
  // screen-local useEffect polling every 200ms and taking literal #1
  // overall used to stand in for that and is why the AI drafted by pure
  // overall regardless of position or need.

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

  // read the board rather than a constant: the fantasy draft's length is a
  // league setting, and this used to say "Round 3 of 20" in a ten-round draft
  const maxRounds = Math.max(1, Math.round(draft.pickOrder.length / Object.keys(s.teams).length));
  const round = Math.floor((draft.currentPickIndex / draft.pickOrder.length) * maxRounds) + 1;
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
  // your stars first: the highest target still on the board (the draft
  // preview is where they're set — they used to go nowhere)
  const myTargets = draftTargetsFor(s, s.viewerGmId);
  const topTarget = mode === "rookie" ? myTargets.find((id) => available.some((a) => a.id === id)) : undefined;
  const suggestedId = yourPick && !complete ? (topTarget ?? bestAvailable(s)) : null;
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
      {!isDraftStage && (
        <FullScreenOverlay
          kicker="Draft complete"
          big="Every pick is in."
          note={`Click anywhere to continue to the ${draft.mode === "fantasy" ? "Fantasy Draft Summary" : "Rookie Draft Summary"}.`}
          onDismiss={() => nav(STAGE_HOME[s.stage])}
        />
      )}

      <CardHeader
        badge={code ? TEAMS_BY_CODE[code]!.abbr : "FS"}
        title="Draft Room"
        subtitle={`${displaySeason(s)} ${mode === "fantasy" ? "Fantasy Draft" : "Rookie Draft"} · Round ${Math.min(round, maxRounds)} · ${cap(draft.order)}`}
      />
      <Ticker
        stats={[
          {
            label: "On the clock",
            value: complete ? "Complete" : onClockTeam ? TEAMS_BY_CODE[onClockTeam]!.label : "—",
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
        <div style={{ padding: "12px 26px 0", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          {market.controls}
          {active === "available" && (
            <label style={{ fontSize: 11.5, color: "var(--ink-faint)", display: "flex", gap: 6, alignItems: "center" }}>
              Sort
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "board" | "fit")}>
                <option value="board">Draft board</option>
                <option value="fit">Best fit for your units</option>
              </select>
            </label>
          )}
        </div>
      )}

      <Panel id="available" open={active === "available"}>
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
                  — {suggested.id === topTarget ? "your top target" : "best fit for your roster"}:{" "}
                  <strong style={{ color: "var(--ink)" }}>{suggested.name}</strong>{" "}
                  <span style={{ color: "var(--ink-dim)", fontWeight: 500 }}>
                    ({suggested.position}, {suggested.ovr} {mode === "rookie" ? "grade" : "OVR"})
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
                disabled={picking}
                onClick={() => pick(suggested.id)}
              >
                {picking ? "Drafting…" : `Draft ${suggested.name}`}
              </button>
            )}
          </div>
        )}
        {pickError && (
          <div className="notice bad" role="status">
            {pickError}
          </div>
        )}
        {filtered.length === 0 && (
          <div className="emptystate" style={{ marginBottom: 12 }}>
            No {posFilter === "ALL" ? "players" : posFilter} left on the board.
          </div>
        )}
        <div className="scroll-list" style={{ overflowX: "auto" }}>
          <table className="stbl">
            <thead>
              <tr>
                <th>Player</th>
                <th className="c">Pos</th>
                {/* a rookie board shows college grades, which run high */}
                <th className="c">{mode === "rookie" ? "Grade" : "OVR"}</th>
                <th className="c">Age</th>
                <th className="r"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="name">
                    {mode === "fantasy" ? (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setInspect(s.players[p.id] ?? null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setInspect(s.players[p.id] ?? null);
                        }}
                        style={{ textDecoration: "underline", textDecorationColor: "var(--line-strong)", cursor: "pointer" }}
                      >
                        {p.name}
                      </span>
                    ) : (
                      p.name
                    )}
                    {fit && <FitTag fit={fit(p.position, p.ovr)} />}
                    {myTargets.includes(p.id) && (
                      <span title="One of your draft targets" style={{ marginLeft: 6, color: "var(--notice)" }}>★</span>
                    )}
                    <span style={{ display: "block", fontSize: 10.5, color: "var(--ink-faint)" }}>{p.sub}</span>
                  </td>
                  <td className="c">{p.position}</td>
                  <td className="c">
                    <OvrPill value={p.ovr} />
                  </td>
                  <td className="c">{p.age}</td>
                  <td className="r">
                    <button
                      className="btn-primary"
                      style={{ fontSize: 11, padding: "6px 10px" }}
                      disabled={!yourPick || complete || picking}
                      onClick={() => pick(p.id)}
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

      <Panel id="mine" open={active === "mine"}>
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

      <Panel id="needs" open={active === "needs"}>
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

      <Panel id="board" open={active === "board"}>
        <div className="scroll-list">
          {[...draft.results]
            .reverse()
            .filter((r) => posFilter === "ALL" || r.selectedPosition === posFilter)
            .slice(0, 60)
            .map((r) => (
              <div key={r.pickNumber} style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr", alignItems: "center", gap: 12, padding: "10px 6px", borderBottom: "1px solid var(--line)" }}>
                <span style={{ fontSize: 13, color: "var(--ink-dim)" }}>#{r.pickNumber}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500 }}>
                  <TeamBadge code={r.teamCode} size={18} />
                  {TEAMS_BY_CODE[r.teamCode]?.label ?? r.teamCode}
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
        {/*
          Change 1: no manual "Autopick Rest" button. When every GM has taken
          the picks the commissioner asked for, the rest of the board
          completes on the server and the league moves on by itself — the
          "draft complete" overlay above is what the player presses to leave.
          Offline the same rule applies locally.
        */}
        <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
          {threshold == null
            ? "Every pick in this draft is made by hand."
            : picksLeftForYou > 0
              ? `${picksLeftForYou} more ${picksLeftForYou === 1 ? "pick" : "picks"} to make. The rest of the draft completes itself once every GM reaches ${threshold}.`
              : "You're done. The draft completes once every other GM reaches their picks."}
        </span>
      </Footer>

      {inspect && <PlayerStatsModal player={inspect} onClose={() => setInspect(null)} />}
    </Card>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
