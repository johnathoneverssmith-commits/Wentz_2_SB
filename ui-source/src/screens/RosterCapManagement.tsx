import { viewerWeek } from "@/state/reveal";
import { getMotionLevel } from "@/motion/level";
import { StaggerList } from "@/motion/Stagger";
import { onlineSession } from "@/state/online";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { careerArc } from "@/state/careerArc";
import { displaySeason, STAGE_LABEL } from "@/state/stageMachine";
import { useNavigate, useSearchParams } from "react-router-dom";

import { PlayerStatsModal } from "@/components/PlayerStatsModal";
import { ContractFacts, RosterFinance, StaffCost } from "@/components/roster/RosterFinance";
import { CapField } from "@/components/roster/CapField";
import { GameDayMasthead } from "@/components/roster/GameDayMasthead";
import { mastheadPalette } from "@/components/roster/teamArt";
import { MotionMeter, MotionSurface } from "@/motion/MotionSurface";
import { AnimatedNumber } from "@/motion/AnimatedNumber";
import "@/components/roster/gameday.css";
import { ContractNegotiation } from "@/components/ContractNegotiation";
import { useLeagueActions } from "@/state/useLeagueActions";
import { Footer, Panel, Tabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { UnitGrades } from "@/components/UnitGrades";
import {
  POSITION_GROUPS,
  POSITION_TO_GROUP,
  type Player,
  type Position,
  type PositionGroup,
} from "@/domain";
import { useStore } from "@/state/store";
import { HybridSimulationService } from "@/sim/HybridSimulationService";
import { playerPriorities } from "@/sim/priorities";
import {
  extensionAsk,
  fifthYearEligible,
  previewFifthYearOption,
  previewFranchiseTag,
  previewRestructure,
} from "@/state/contracts";
import { depthAt } from "@/state/seed";
import { onInjuredReserve } from "@/state/injuries";
import {
  checkPromote,
  checkToPracticeSquad,
  PRACTICE_SQUAD_SIZE,
  practiceSquad,
  practiceSquadEligible,
} from "@/state/practiceSquad";
import { marketScale, minSalaryM } from "@/state/capEconomy";
import { capUsed as contractsUsed, checkRelease, positionalMinimums, releasePenalty } from "@/state/reconciliation";
import { leagueStarterOverall } from "@/state/leagueStarters";
import { unitReport, type UnitRow } from "@/state/unitReport";
import { teamRoster, viewerTeamCode } from "@/state/selectors";
import { millions, posLabel } from "@/util/format";

const sim = new HybridSimulationService();

const GROUP_LABEL: Record<PositionGroup, string> = {
  QB: "Quarterback", RB: "Running back", WR: "Wide receiver", TE: "Tight end",
  OL: "Offensive line", DL: "Defensive line", EDGE: "Edge rusher", LB: "Linebacker",
  CB: "Cornerback", S: "Safety", K: "Kicker", P: "Punter",
};

/** The heading over each group's depth chart. */
const GROUP_TITLE: Record<PositionGroup, string> = {
  QB: "Quarterbacks", RB: "Running backs", WR: "Receivers", TE: "Tight ends",
  OL: "Offensive line", DL: "Defensive line", EDGE: "Edge rushers", LB: "Linebackers",
  CB: "Cornerbacks", S: "Safeties", K: "Kickers", P: "Punters",
};

/**
 * The engine unit each position group plays in (`unitReport`), for the grade
 * on its tab. Kickers and punters aren't graded as a unit.
 */
const GROUP_UNIT: Partial<Record<PositionGroup, string>> = {
  QB: "quarterback", RB: "runningBack", WR: "receivers", TE: "tightEnd", OL: "offensiveLine",
  DL: "interior", EDGE: "passRush", LB: "linebackers", CB: "corners", S: "safeties",
};

const ARC_CLASS = { Rising: "rise", Prime: "prime", Declining: "decline" } as const;

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

const ovrTier = (overall: number): string => (overall >= 85 ? "elite" : overall >= 75 ? "mid" : "low");

export function RosterCapManagement() {
  const nav = useNavigate();
  const s = useStore();
  const actions = useLeagueActions();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const active = requestedTab && ["cap", "units", "needs"].includes(requestedTab) ? requestedTab : "roster";
  const setActive = (tab: string): void => {
    const next = new URLSearchParams(params);
    if (tab === "roster") next.delete("tab"); else next.set("tab", tab);
    setParams(next, { replace: true });
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dossierRef = useRef<HTMLElement>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [group, setGroup] = useState<PositionGroup>("QB");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restructuring, setRestructuring] = useState<string | null>(null);
  const [extending, setExtending] = useState<Player | null>(null);
  const [extendError, setExtendError] = useState<string | null>(null);
  const [moveNote, setMoveNote] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  // the guard itself: state lags a render, so two quick clicks both passed it
  const nudgingRef = useRef(false);
  const [reordering, setReordering] = useState(false);
  const code = viewerTeamCode(s);
  // the server locks the chart while a block of weeks is being revealed
  // (`refuseDuringBlock`); every move button used to find that out by being
  // refused one click at a time
  const depthLocked = onlineSession() !== null && (s.stage === "preseason" || s.stage === "regularSeason");
  const isDepthChartStage =
    s.stage === "offseasonDepthChart" || s.stage === "midseasonDepthChart";
  const back = s.returnTo
    ? { to: s.returnTo, label: "Return to retirements" }
    : { to: "/hub", label: "Return to team hub" };

  const roster = useMemo(() => (code ? teamRoster(s, code) : []), [s, code]);
  // ratings and depth charts only: the league's typical starter at each position
  const leagueStarters = useMemo(
    () => leagueStarterOverall({ players: s.players, teams: s.teams, depthChart: s.depthChart }),
    [s.players, s.teams, s.depthChart],
  );
  const units = useMemo(
    () => (code && s.teams[code] ? unitReport(s, code).units : []),
    [s, code],
  );
  const palette = useMemo(() => mastheadPalette(code ?? ""), [code]);
  // players on injured reserve don't hold one of the 53 spots
  const onIr = roster.filter((p) => onInjuredReserve(p, s.stage)).length;
  const activeCount = roster.length - onIr;
  const team = code ? s.teams[code] : undefined;
  const staff = Object.values(s.coaches).filter((c) => c.team === code);
  const oc = staff.find((c) => c.role === "OC") ?? null;
  const dc = staff.find((c) => c.role === "DC") ?? null;

  if (!code || !team) {
    return (
      <div className="roster-workspace gd">
        <div className="gd-page">
          <div className="emptystate">Pick a team in League Setup first.</div>
        </div>
      </div>
    );
  }

  // the store's own cap figures (players + coaching staff) — the same numbers
  // the signing checks use, so this screen never disagrees with them
  const capUsed = team.cap.used;
  const capTotalM = team.cap.total;
  const capSpace = Math.round((capTotalM - capUsed) * 10) / 10;
  const overContracts = Math.round((contractsUsed(s, code) - capTotalM) * 10) / 10;
  const staffCap = Object.values(s.coaches)
    .filter((c) => c.team === code)
    .reduce((n, c) => n + (c.contract?.annualValue ?? 0), 0);

  // Depth is per position, not per group: "OL" covers three of them, and a
  // left tackle isn't competing with a centre for a spot.
  const positionsInGroup = (Object.keys(POSITION_TO_GROUP) as Position[]).filter(
    (pos) => POSITION_TO_GROUP[pos] === group,
  );
  const ordered = positionsInGroup.flatMap((pos) => depthAt(s, code, pos));
  const starters = positionalMinimums();

  /**
   * Move a player one place up or down the chart at his own position.
   *
   * One move at a time: online, two quick clicks both read the chart as it
   * was before either landed, so the second undid the first.
   */
  const nudge = (p: Player, by: -1 | 1): void => {
    if (nudgingRef.current) return;
    const line = depthAt(s, code, p.position).map((x) => x.id);
    const i = line.indexOf(p.id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= line.length) return;
    [line[i], line[j]] = [line[j]!, line[i]!];
    setSelectedId(p.id);
    nudgingRef.current = true;
    void actions
      .setDepthOrder(p.position, line)
      .then((r) => {
        if (!r.ok) setMoveNote({ id: p.id, ok: false, text: r.reason ?? "Couldn't change the depth chart." });
      })
      .finally(() => {
        nudgingRef.current = false;
      });
  };
  const lineAt = (pos: Position) => ordered.filter((x) => x.position === pos);
  const slotOf = (p: Player): number => lineAt(p.position).indexOf(p) + 1;

  const needs = POSITION_GROUPS.map((g) => {
    const players = roster.filter((p) => POSITION_TO_GROUP[p.position] === g);
    const top = players[0]?.overall ?? 0;
    const depth = players.length;
    if (depth === 0) return { g, level: "urgent" as const, reason: "No players on the roster" };
    // a group can look full and still leave a starting spot empty: five
    // linemen with one guard started a "Vacant" at guard, and this tab
    // listed nothing
    const mins = positionalMinimums();
    const shortAt = (Object.keys(POSITION_TO_GROUP) as Position[])
      .filter((pos) => POSITION_TO_GROUP[pos] === g)
      .find((pos) => players.filter((p) => p.position === pos).length < (mins[pos] ?? 0));
    if (shortAt) {
      const have = players.filter((p) => p.position === shortAt).length;
      return { g, level: "urgent" as const, reason: `${shortAt}: ${have} of ${mins[shortAt]} starters — a starting spot is empty` };
    }
    if (top < 72) return { g, level: "upgrade" as const, reason: `Weak starter (${top} OVR), no upgrade in house` };
    if (depth < 2 && g !== "K" && g !== "P") return { g, level: "depth" as const, reason: "Starter only, no depth" };
    return null;
  }).filter(Boolean) as Array<{ g: PositionGroup; level: "urgent" | "upgrade" | "depth"; reason: string }>;

  const capByUnit = {
    offense: roster.filter((p) => ["QB", "RB", "WR", "TE", "OT", "OG", "C"].includes(p.position)).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0),
    defense: roster.filter((p) => ["EDGE", "DT", "ILB", "OLB", "CB", "S"].includes(p.position)).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0),
    special: roster.filter((p) => ["K", "P"].includes(p.position)).reduce((n, p) => n + (p.contract?.cap_hit_by_year[0] ?? 0), 0),
  };

  const unitFor = (g: PositionGroup): UnitRow | undefined => {
    const key = GROUP_UNIT[g];
    return key ? units.find((u) => u.key === key) : undefined;
  };
  const groupUnit = unitFor(group);

  const selected = ordered.find(p => p.id === selectedId) ?? ordered[0];
  const choosePlayer = (p: Player): void => {
    setSelectedId(p.id);
    setConfirming(null);
    if (window.matchMedia("(max-width: 1050px)").matches) requestAnimationFrame(() => {
      dossierRef.current?.focus({ preventScroll: true });
      dossierRef.current?.scrollIntoView({ behavior: getMotionLevel() === "off" ? "auto" : "smooth", block: "start" });
    });
  };
  const positionNav = (
    <div className="position-pills gd-positions" role="group" aria-label="Position group">
      {POSITION_GROUPS.map((g) => {
        const u = unitFor(g);
        return (
          <button
            type="button"
            key={g}
            // the grade is visible beside the code; the name stays the code itself
            aria-label={g}
            title={u ? `${GROUP_LABEL[g]}: unit grade ${u.grade}, ${ordinal(u.rank)} of ${u.teams}` : GROUP_LABEL[g]}
            aria-pressed={group === g}
            onClick={() => { setGroup(g); setSelectedId(null); setConfirming(null); }}
          >
            <b>{g}</b>
            <i aria-hidden="true" className={u ? `gd-grade g-${u.grade.charAt(0)}` : "gd-grade"}>{u?.grade ?? "–"}</i>
          </button>
        );
      })}
    </div>
  );

  const playerActions = (p: Player) => (
    <div className="gd-actions">
      <button type="button" className="gd-btn gd-go" onClick={() => setExtending(p)}>Extend contract</button>
      <p className="gd-actions-label">Lineup</p>
      <div className="gd-two">
        <button
          type="button"
          className="gd-btn"
          onClick={() => nudge(p, -1)}
          disabled={depthLocked || lineAt(p.position)[0]?.id === p.id}
          title={`Move up the ${posLabel(p.position)} depth chart`}
        >
          Move up
        </button>
        <button
          type="button"
          className="gd-btn"
          onClick={() => nudge(p, 1)}
          disabled={depthLocked || lineAt(p.position).at(-1)?.id === p.id}
          title={`Move down the ${posLabel(p.position)} depth chart`}
        >
          Move down
        </button>
      </div>
      <p className="gd-actions-label">Contract</p>
      <div className="gd-two">
        <button
          type="button"
          className="gd-btn"
          onClick={() => {
            // the local action knows exactly what it freed;
            // the server answers with the new league instead, so
            // online the preview's arithmetic stands in
            const estimate = previewRestructure(p, s.season, minSalaryM(s)).freed;
            // a second tap before the answer came back was refused
            // ("already restructured"), and that note replaced
            // the success one — the deal looked like it had failed
            setRestructuring(p.id);
            void actions.restructure(p.id).finally(() => setRestructuring(null)).then((r) => {
              setMoveNote({
                id: p.id,
                ok: r.ok,
                text: r.ok
                  ? `Restructured — ${millions(r.freed ?? estimate ?? 0)} off this year's cap, moved into the rest of the deal.`
                  : (r.reason ?? "Couldn't restructure that deal."),
              });
            });
          }}
          disabled={restructuring === p.id || !previewRestructure(p, s.season, minSalaryM(s)).ok}
          title={previewRestructure(p, s.season, minSalaryM(s)).reason ?? "Convert salary to bonus: cheaper now, dearer later"}
        >
          Restructure
        </button>
        <button type="button" className="gd-btn" onClick={() => setInspecting(p.id)}>Player card</button>
        {p.contract?.years_remaining === 1 && (
          <button
            type="button"
            className="gd-btn"
            onClick={() => {
              void actions.tender(p.id, "tag").then((r) =>
                setMoveNote({
                  id: p.id,
                  ok: r.ok,
                  text: r.ok
                    ? `Tagged. ${p.name} plays next season on a one-year tender of ${millions(previewFranchiseTag(s, p).price ?? 0)}.`
                    : (r.reason ?? "Couldn't tag him."),
                }),
              );
            }}
            disabled={!previewFranchiseTag(s, p).ok}
            title={
              previewFranchiseTag(s, p).reason ??
              `Keep him off the market one more year at ${millions(previewFranchiseTag(s, p).price ?? 0)}, fully guaranteed`
            }
          >
            Franchise tag ({millions(previewFranchiseTag(s, p).price ?? 0)})
          </button>
        )}
        {practiceSquadEligible(p, marketScale(s)) && (
          <button
            type="button"
            className="gd-btn"
            onClick={() => {
              void actions.tender(p.id, "practiceSquad").then((r) => {
                if (!r.ok) setMoveNote({ id: p.id, ok: false, text: r.reason ?? "Couldn't move him." });
              });
            }}
            disabled={depthLocked || !checkToPracticeSquad(s, p).ok}
            title={
              checkToPracticeSquad(s, p).reason ??
              "Keep him and develop him without a roster spot: off the 53, out of games, on a $0.2M deal"
            }
          >
            To practice squad
          </button>
        )}
        {fifthYearEligible(p) && (
          <button
            type="button"
            className="gd-btn"
            onClick={() => {
              void actions.tender(p.id, "option").then((r) =>
                setMoveNote({
                  id: p.id,
                  ok: r.ok,
                  text: r.ok
                    ? `Option picked up: one more year at ${millions(previewFifthYearOption(s, p).price ?? 0)}, fully guaranteed.`
                    : (r.reason ?? "Couldn't pick up the option."),
                }),
              );
            }}
            disabled={!previewFifthYearOption(s, p).ok}
            title={previewFifthYearOption(s, p).reason ?? "Add a fifth year to his rookie deal at a fixed tender"}
          >
            5th-year option ({millions(previewFifthYearOption(s, p).price ?? 0)})
          </button>
        )}
      </div>
      {confirming === p.id ? (
        <div className="gd-two">
          <button
            type="button"
            className="gd-btn gd-cut btn-danger"
            onClick={() => {
              void actions.releasePlayer(p.id).then((r) => {
                if (!r.ok) setMoveNote({ id: p.id, ok: false, text: r.reason ?? "Couldn't release him." });
              });
              setConfirming(null);
            }}
          >
            Confirm release
          </button>
          <button type="button" className="gd-btn" onClick={() => setConfirming(null)}>Keep him</button>
        </div>
      ) : (
        <button
          type="button"
          className="gd-btn gd-cut btn-danger"
          onClick={() => setConfirming(p.id)}
          // the server won't release anyone mid-block either (`refuseDuringBlock`)
          disabled={depthLocked || !checkRelease(s, code, p.id).ok}
          title={depthLocked ? "Releases open again at the next break." : checkRelease(s, code, p.id).reason}
        >
          Release
        </button>
      )}
      <p className={"gd-note" + (moveNote?.id === p.id && !moveNote.ok ? " form-error" : "")}>
        {moveNote?.id === p.id
          ? moveNote.text
          : confirming === p.id
            ? `Releasing ${p.name} takes his ${millions(p.contract?.cap_hit_by_year[0] ?? 0)} off the books and leaves ${millions(releasePenalty(p))} of dead money this year. He goes to the free agent market. This can't be undone.`
            : // why a button is grey, where a phone can read it — the
              // reasons lived only in hover titles
              ([
                previewRestructure(p, s.season, minSalaryM(s)).ok ? null : `Restructure: ${previewRestructure(p, s.season, minSalaryM(s)).reason}`,
                depthLocked || checkRelease(s, code, p.id).ok ? null : `Release: ${checkRelease(s, code, p.id).reason}`,
              ]
                .filter(Boolean)
                .join(" ") ||
              "A restructure moves money into later years; it doesn't make it go away. Releasing a player costs dead money this year: part of what's left on his deal.")}
      </p>
    </div>
  );

  const playerDossier = (p: Player, compact = false) => {
    const slot = slotOf(p);
    const starting = slot > 0 && slot <= (starters[p.position] ?? 0);
    return (
      <aside ref={dossierRef} tabIndex={-1} data-player-id={p.id} data-compact={compact} className="player-dossier gd-card" aria-label="Selected player">
        <div className="gd-card-head">
          <div>
            <h3>{p.name}</h3>
            <p>
              {posLabel(p.position)}, age {p.age}, {starting ? "starter" : slot > 0 ? `depth ${slot}` : "not on the chart"}
            </p>
          </div>
          <b className="gd-card-ovr" aria-label={`Overall ${p.overall}`}>{p.overall}</b>
        </div>
        {compact ? (
          <section className="finance-cap-schedule gd-sec" aria-label="Scheduled cap hits">
            <h4>Cap hits by remaining year</h4>
            {p.contract ? (
              <dl className="gd-ledger">
                {p.contract.cap_hit_by_year.map((hit, i) => <div key={i}><dt>Remaining year {i + 1}</dt><dd>{millions(hit)}</dd></div>)}
              </dl>
            ) : <p>No contract on record.</p>}
          </section>
        ) : (
          <div className="gd-sec"><ContractFacts contract={p.contract} /></div>
        )}
        {playerActions(p)}
        <details className="player-extra gd-extra">
          <summary>{compact ? "Full contract and player details" : "More player details"}</summary>
          {compact && <ContractFacts contract={p.contract} />}
          <dl className="gd-ledger">
            <div><dt>{displaySeason(s)} cap hit</dt><dd>{p.contract ? millions(p.contract.cap_hit_by_year[0] ?? 0) : "—"}</dd></div>
            <div><dt>Years left</dt><dd>{p.contract?.years_remaining ?? 0}</dd></div>
            <div><dt>Guaranteed</dt><dd>{p.contract ? millions(p.contract.guaranteed) : "—"}</dd></div>
            {/* computed against the coordinators this team has right
                now, not a number frozen into the player: a hiring
                window changes every fit on the roster, and the
                engine's pool carries no `scheme_fit` at all, so the
                stored field read "—%" for every real player. */}
            <div><dt>Scheme fit</dt><dd>{sim.computeSchemeFit(p, oc, dc)}%</dd></div>
          </dl>
          <div className="roster-player-rating"><span>Overall {p.overall}</span><MotionMeter value={p.overall} label={`${p.name} overall`} tone="purple" /></div>
        </details>
      </aside>
    );
  };

  const markers = (p: Player) => (
    <>
      {p.injury_status && (
        <span
          className="gd-marker bad"
          title={`${p.injury_status.description}${p.injury_status.weeks_out_est ? `, ${p.injury_status.weeks_out_est[0]}-${p.injury_status.weeks_out_est[1]} weeks` : ""}`}
        >
          {/* spoken it was "OTQ": the space, and the whole word for "Q" */}{" "}
          <span aria-hidden="true">
            {onInjuredReserve(p, s.stage) ? "IR" : p.injury_status.status === "questionable" ? "Q" : p.injury_status.status === "doubtful" ? "D" : "OUT"}
          </span>
          <span className="sr-only">
            {onInjuredReserve(p, s.stage) ? "injured reserve" : p.injury_status.status}
          </span>
        </span>
      )}
      {p.holdout === p.nfl_team && (
        <span
          className="gd-marker notice"
          title="Holding out for a new contract: he sits until he's extended or traded, or reports at the trade deadline"
        >
          Holdout
        </span>
      )}
      {p.contract?.franchise_tag_season === s.season && (
        <span className="gd-marker" title="Franchise-tagged for next season">Tag</span>
      )}
    </>
  );

  const week = viewerWeek(s);
  const style = {
    "--gd-team": palette.bg,
    "--gd-team-ink": palette.ink,
    "--gd-accent": palette.accent,
    "--gd-on-accent": palette.onAccent,
    "--gd-accent-text": palette.accentText,
  } as CSSProperties;

  return (
    <div className="roster-workspace gd" style={style}>
    <div className="gd-page">
      <GameDayMasthead
        code={code}
        title={active === "cap" ? "Finances & salary cap" : "Roster & depth chart"}
        sub={
          <>
            {displaySeason(s)} season, {STAGE_LABEL[s.stage]}{week ? `, week ${week}` : ""}.{" "}
            Team overall {team.ratings.overall}, {ordinal(team.ratings.overallRank)} of {Object.keys(s.teams).length}.{" "}
            {activeCount} of 53 on the active roster{onIr ? `, ${onIr} on injured reserve` : ""}.
          </>
        }
        actions={
          <button type="button" className="gd-flat" onClick={() => nav("/trade")} title="Proposals are made in the Trade Deadline room">
            Trade history
          </button>
        }
      />
      <CapField total={capTotalM} used={capUsed} room={capSpace} dead={team.cap.dead} />
      {/* legality is the contracts — dead money shrinks the room to add
          anyone, but it can't make this roster illegal (reconciliation.ts) */}
      {(overContracts > 0 || activeCount > 53) && (
        <div className="notice bad gd-notice" role="status">
          <strong>Not season-legal yet.</strong>{" "}
          {[
            overContracts > 0 ? `${millions(overContracts)} over the cap` : null,
            activeCount > 53 ? `${activeCount - 53} over the 53-man limit` : null,
          ]
            .filter(Boolean)
            .join(" and ")}
          . Release players below to get compliant — otherwise your staff makes
          the cuts for you when the league advances to the preseason.
        </div>
      )}
      {/* the staff fills every roster to 53 at the preseason: a GM who left
          the depth chart at 43 met ten minimum-salary strangers there, and
          nothing on this screen had said it would happen */}
      {s.stage === "offseasonDepthChart" && activeCount < 53 && overContracts <= 0 && (
        <div className="notice gd-notice" role="status">
          {/* depth signs at the $1M minimum; when it won't fit the fill makes
              room by releasing contracts — and "sign your own first" beside
              $0.2M of room was advice nobody could take */}
          {53 - activeCount > capTotalM - contractsUsed(s, code) ? (
            <>
              You&rsquo;re {53 - activeCount} short of 53 with{" "}
              {millions(Math.max(0, Math.round((capTotalM - contractsUsed(s, code)) * 10) / 10))} of cap room.{" "}
              <strong>
                When the preseason starts your staff signs about {millions(53 - activeCount)} of
                minimum-salary depth and releases someone to afford it
              </strong>{" "}
              — make the cut yourself first if you&rsquo;d rather pick who.
            </>
          ) : (
            <>
              You&rsquo;re {53 - activeCount} short of 53. When the preseason starts your staff fills the
              rest with minimum-salary depth from free agency — sign your own on the{" "}
              <button type="button" className="btnlink" onClick={() => nav("/free-agency")}>
                free-agency board
              </button>{" "}
              first if you&rsquo;d rather choose.
            </>
          )}
        </div>
      )}
      <div className="gd-hub">
        <Tabs
          tabs={[
            { id: "roster", label: "Depth chart" },
            { id: "cap", label: "Cap table" },
            { id: "units", label: "Unit grades" },
            { id: "needs", label: "Positional needs" },
          ]}
          active={active}
          onChange={setActive}
        />
      </div>

      <Panel id="roster" open={active === "roster"}>
        {active === "roster" && (
        <div className="gd-board">
        <section className="gd-depth" aria-label="Depth chart">
        {positionNav}
        <div className="gd-unit">
          <div>
            <h2>{GROUP_TITLE[group]}</h2>
            <p>
              {groupUnit
                ? `Unit grade ${groupUnit.grade}, ${ordinal(groupUnit.rank)} of ${groupUnit.teams} in the league`
                : "Not graded as a unit"}
            </p>
          </div>
          {/* through the league actions, not the local store: online the
              store-only reset never reached the server and the next refresh
              put the old order back */}
          <button
            type="button"
            className="gd-btn gd-small"
            disabled={reordering || depthLocked}
            onClick={() => {
              // one batch and one download, and a refusal (the chart locks
              // while a block of weeks plays out) is shown, not swallowed
              setReordering(true);
              void actions
                .setDepthOrders(positionsInGroup.map((position) => ({ position, playerIds: [] })))
                .then((r) => {
                  if (!r.ok) setMoveNote({ id: "", ok: false, text: r.reason ?? "Couldn't reorder." });
                })
                .finally(() => setReordering(false));
            }}
          >
            {reordering ? "Reordering…" : "Auto-reorder by overall"}
          </button>
        </div>
        {depthLocked && (
          <div className="notice gd-notice" role="status">
            The depth chart and releases are locked while this stretch of games plays out — they
            were played with today&rsquo;s roster. Both open again at the next break.
          </div>
        )}
        {moveNote?.id === "" && !moveNote.ok && (
          <p className="form-error" role="status">
            {moveNote.text}
          </p>
        )}

        {ordered.length === 0 && (
          <div className="emptystate">No players in this group.</div>
        )}
        <StaggerList className="rowlist roster-list gd-strips">
          {ordered.map((p) => {
            const slot = slotOf(p);
            const starting = slot <= (starters[p.position] ?? 0);
            const typical = leagueStarters[p.position];
            const delta = typical === undefined ? null : p.overall - typical;
            const arc = careerArc(p);
            return (
              <button
                key={p.id}
                type="button"
                data-player-id={p.id}
                className={"prow gd-strip" + (selected?.id === p.id ? " selected" : "")}
                aria-pressed={selected?.id === p.id}
                onClick={() => choosePlayer(p)}
              >
                <span className="gd-slot">{slot}</span>
                <span className="gd-who">
                  <span className="gd-name-line"><span className="roster-name">{p.name}</span>{markers(p)}</span>
                  <span className="gd-meta">
                    {p.position}{slot}{starting ? ", starter" : ""}
                    {delta !== null && <>, {delta >= 0 ? "+" : "−"}{Math.abs(delta)} vs league starter</>}
                  </span>
                </span>
                <span className="gd-fact gd-age" title={arc.hint}>
                  <small>Age</small>
                  <b>{p.age}</b>
                  <span className={`gd-arc ${ARC_CLASS[arc.label]}`}>{arc.label}</span>
                </span>
                <span className="gd-fact"><small>Deal</small><b>{p.contract ? `${p.contract.years_remaining} yr` : "FA"}</b></span>
                <span className="gd-fact gd-cap"><small>Cap hit</small><b>{p.contract ? millions(p.contract.cap_hit_by_year[0] ?? 0) : "—"}</b></span>
                <span className={`gd-ovr ${ovrTier(p.overall)}`}><b>{p.overall}</b><small>Overall</small></span>
              </button>
            );
          })}
        </StaggerList>
        {(() => {
          const squad = practiceSquad(s, code);
          return (
            <div className="gd-ps">
              <h3>Practice squad: {squad.length} of {PRACTICE_SQUAD_SIZE}</h3>
              {squad.length === 0 ? (
                <p>
                  Nobody here yet. A player with two seasons or fewer on a minimum-level deal can be moved
                  here from his row above: he stays yours and keeps developing, without a roster spot, and
                  doesn&rsquo;t play.
                </p>
              ) : (
                <ul>
                  {squad.map((p) => (
                    <li key={p.id}>
                      <span className="gd-ps-name">
                        <b>{p.name}</b> {posLabel(p.position)}, age {p.age}
                      </span>
                      <span className={`gd-ps-ovr ${ovrTier(p.overall)}`} aria-label={`Overall ${p.overall}`}>{p.overall}</span>
                      <button
                        type="button"
                        className="gd-btn gd-small"
                        onClick={() => {
                          void actions.tender(p.id, "promote").then((r) => {
                            if (!r.ok) setMoveNote({ id: p.id, ok: false, text: r.reason ?? "Couldn't promote him." });
                          });
                        }}
                        disabled={depthLocked || !checkPromote(s, p).ok}
                        title={checkPromote(s, p).reason ?? "Promote to the 53 on a one-year minimum deal"}
                      >
                        Promote
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {moveNote && squad.some((p) => p.id === moveNote.id) && (
                <p className="form-error">{moveNote.text}</p>
              )}
            </div>
          );
        })()}
        </section>
        {selected && playerDossier(selected)}
        </div>
        )}
      </Panel>

      <Panel id="cap" open={active === "cap"}>
        {active === "cap" && (
        <div className="roster-finance-layout gd-finance">
        <RosterFinance total={capTotalM} used={capUsed} room={capSpace} dead={team.cap.dead} />
        <MotionSurface className="ui-surface roster-allocation gd-panel" index={1}>
        <div className="ui-section-heading"><div><h2>Cap allocation</h2><p>Current player cap hits by unit</p></div></div>
        <CapBar label="Offense" value={capByUnit.offense} max={capUsed} />
        <CapBar label="Defense" value={capByUnit.defense} max={capUsed} />
        <CapBar label="Special teams" value={capByUnit.special} max={capUsed} />
        <StaffCost value={staffCap}/>
        <p className="ui-caption">Unit bars show each group's share of used player cap. Dead money is listed separately.</p>
        </MotionSurface>
        </div>
        )}
        {active === "cap" && (
          <div className="gd-board gd-finance-lower">
            <section className="gd-depth contract-board" aria-label={`${GROUP_LABEL[group]} contracts`}>
              {positionNav}
              <div className="gd-unit"><div><h2>{GROUP_TITLE[group]}</h2><p>Contracts, in depth-chart order</p></div></div>
              <div className="contract-list-head" aria-hidden="true"><span>Player</span><span>Remaining</span><span>Cap hit</span></div>
              <div className="contract-player-list">
                {ordered.map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    data-player-id={p.id}
                    aria-pressed={selected?.id === p.id}
                    aria-label={`${p.name}, ${p.position}, ${p.contract ? p.contract.years_remaining + " years remaining, " + millions(p.contract.cap_hit_by_year[0] ?? 0) + " cap hit" : "no contract on record"}`}
                    onClick={() => choosePlayer(p)}
                  >
                    <strong>{p.name}</strong>
                    <span>{p.contract?.years_remaining ?? "—"} years</span>
                    <b>{p.contract ? millions(p.contract.cap_hit_by_year[0] ?? 0) : "—"}</b>
                  </button>
                ))}
              </div>
            </section>
            {selected && playerDossier(selected, true)}
          </div>
        )}
      </Panel>

      <Panel id="units" open={active === "units"}>
        {active === "units" && <div className="gd-units"><UnitGrades teamCode={code} /></div>}
      </Panel>

      <Panel id="needs" open={active === "needs"}>
        <div className="gd-needs">
          <h2>Positions needing attention</h2>
          <p>Only spots below roster-health thresholds are listed.</p>
          {needs.length === 0 ? (
            <div className="emptystate">No positional needs flagged.</div>
          ) : (
            <ul>
              {needs.map((n) => (
                <li key={n.g} className="gd-need">
                  <b>{n.g}</b>
                  <span><strong>{GROUP_LABEL[n.g]}</strong> {n.reason}</span>
                  <span className={`gd-level ${n.level}`}>
                    {n.level === "urgent" ? "Starting spot open" : n.level === "upgrade" ? "Upgrade" : "No depth"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Footer>
        <button type="button" className="gd-btn" onClick={() => nav("/league-rosters")}>League Rosters</button>
        <button type="button" className="gd-btn" onClick={() => nav("/free-agency")}>Free agency board</button>
        {/* on the depth-chart stage this screen *is* the stage: "back to
            stage" went round to itself */}
        {!(isDepthChartStage && !s.returnTo) && (
          <button type="button" className="gd-btn gd-go btn-primary" onClick={() => nav(back.to)}>
            {back.label}
          </button>
        )}
      </Footer>

      {isDepthChartStage && (
        <ReadinessGate title="Depth chart readiness" onAdvance={(r) => nav(r)} />
      )}

      {extending && (
        <ContractNegotiation
          title={`Extend — ${extending.name}`}
          subtitle={`${posLabel(extending.position)} · age ${extending.age} · ${extending.overall} OVR · ${extending.contract?.years_remaining ?? 0}y left`}
          priorities={{
            ...playerPriorities(extending),
            // an extension is negotiated against what he'd get on the open
            // market a year from now, not what a free agent asks today
            expectation: { ...extensionAsk(extending, marketScale(s)), signingBonus: 0 },
          }}
          error={extendError}
          noBonus
          onClose={() => {
            setExtendError(null);
            setExtending(null);
          }}
          onSubmit={(offer) => {
            const who = extending.id;
            void actions
              .extend(who, {
                baseSalary: offer.baseSalary,
                years: offer.years,
                guaranteed: offer.guaranteed,
              })
              .then((r) => {
                if (r.ok) {
                  setExtendError(null);
                  setMoveNote({
                    id: who,
                    ok: true,
                    text: `Extended — ${offer.years} more year${offer.years === 1 ? "" : "s"} at ${millions(offer.baseSalary)} a year.`,
                  });
                  setExtending(null);
                } else {
                  setExtendError(r.reason ?? "He turned it down.");
                }
              });
          }}
        />
      )}
      {inspecting && s.players[inspecting] && <PlayerStatsModal player={s.players[inspecting]!} portrait={false} onClose={() => setInspecting(null)} />}
    </div>
    </div>
  );
}

function CapBar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="capbar-row">
      <div className="capbar-label">
        <span>{label}</span>
        <span><AnimatedNumber value={value} format={millions} /></span>
      </div>
      {max > 0 ? <MotionMeter value={value} max={max} label={`${label} cap allocation`} tone={label === "Defense" ? "purple" : label === "Special teams" ? "gold" : "teal"} /> : <p className="ui-caption">No cap allocation yet.</p>}
    </div>
  );
}

