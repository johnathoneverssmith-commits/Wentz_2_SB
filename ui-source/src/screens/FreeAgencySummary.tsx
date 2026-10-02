import { StageLoading } from "@/components/StageLoading";
import { useMemo, useState } from "react";
import { displaySeason } from "@/state/stageMachine";
import { useNavigate } from "react-router-dom";

import { OvrPill, TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
import { TEAMS_BY_CODE } from "@/data/teams";
import { unsignedPool } from "@/state/freeAgencyEvent";
import { expectedSalary, PRIMARY_VALUE_LABEL, primaryValueOf } from "@/state/freeAgencyValues";
import {
  capUsed,
  checkRelease,
  isReconciled,
  positionalMinimums,
  reconciliationIssues,
  planStaffTrim,
  releasePenalty,
  rosterOf,
} from "@/state/reconciliation";
import { ROSTER_SIZE } from "@/sim/roster-template";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { recentNews } from "@/state/online";
import { useLeagueActions } from "@/state/useLeagueActions";
import { andList, millions } from "@/util/format";

/**
 * How free agency went, and the bill.
 *
 * Four tabs, and the fourth is the one with teeth. Everything else is a
 * record of what happened; Roster & Budget is where the cap and the roster
 * limits come back, and advancing is locked until the team is legal on all
 * three counts at once.
 *
 * The tab glows while anything is wrong, because a GM reading their signings
 * has no other reason to look at it and the block would otherwise arrive as a
 * surprise at the moment they tried to leave.
 */
export function FreeAgencySummary() {
  const s = useStore();
  const actions = useLeagueActions();
  const nav = useNavigate();
  const code = viewerTeamCode(s);
  const { active, setActive } = useTabs("yours");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trimming, setTrimming] = useState(false);
  // who the staff let go, and what it cost — it used to happen silently
  const [trimNote, setTrimNote] = useState<string | null>(null);

  const e = s.freeAgencyEvent;
  const issues = useMemo(
    () => (code ? reconciliationIssues(s, code) : []),
    [s.players, s.teams, code], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const legal = !!code && isReconciled(s, code);

  if (!code || !e) {
    return (
      <Card>
        <CardHeader badge="FA" title="Free Agency Summary" subtitle="Loading" />
        <div className="panel open">
          <StageLoading />
        </div>
      </Card>
    );
  }

  const mySignings = e.signed.filter((x) => x.teamCode === code);
  const myLostBids = Object.entries(e.offers)
    .filter(([playerId, list]) => {
      const mine = list.some((o) => o.teamCode === code);
      const won = e.signed.find((x) => x.playerId === playerId);
      return mine && won && won.teamCode !== code;
    })
    .map(([playerId]) => playerId);

  const roster = rosterOf(s, code);
  // weakest first put four cornerbacks in a row at the top: release them all
  // and the roster read "legal" with no backup left at the position. Say so
  // on the release that leaves only the starters.
  const positionCount = new Map<string, number>();
  for (const p of roster) positionCount.set(p.position, (positionCount.get(p.position) ?? 0) + 1);
  const minimums = positionalMinimums();
  const lastBackup = (pos: string): boolean =>
    (minimums[pos] ?? 0) > 0 && (positionCount.get(pos) ?? 0) - 1 === minimums[pos];
  // the fill is written as the market's last round closes — so a line older
  // than that round is last year's, still in the kept news
  const news = recentNews();
  const lastRound = news.filter((e) => e.kind === "fa.round").reduce((m, e) => (e.at > m ? e.at : m), "");
  const staffFill =
    s.stage === "freeAgencySummary"
      ? news.find(
          (e) => e.kind === "roster.staff" && e.teamCode === code && /after free agency/.test(e.summary) && e.at >= lastRound,
        )
      : undefined;
  // legality is the contracts (`capUsed`); the books also carry dead money,
  // which the Roster & Cap screen counts — show the same numbers here
  const used = capUsed(s, code);
  const dead = s.teams[code]?.cap.dead ?? 0;
  const booked = Math.round((used + dead) * 10) / 10;
  const total = s.teams[code]?.cap.total ?? 0;
  const overLimitOnly = issues.some((i) => i.kind === "roster") && !issues.some((i) => i.kind === "cap");

  const release =(playerId: string) => {
    setBusy(true);
    setError(null);
    void actions
      .releasePlayer(playerId)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "Couldn't release him.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card maxWidth={920}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title={s.stage === "midseasonFreeAgencySummary" ? "Mid-Season Free Agency Summary" : "Free Agency Summary"}
        subtitle={`${displaySeason(s)} · ${mySignings.length} signed`}
      />
      <Ticker
        stats={[
          { label: "Signed", value: mySignings.length },
          { label: "Roster", value: `${roster.length} / ${ROSTER_SIZE}`, className: roster.length > ROSTER_SIZE ? "bad" : undefined },
          { label: "Cap used", value: millions(booked), className: used > total ? "bad" : "good" },
          { label: "Cap space", value: millions(Math.round((total - booked) * 10) / 10), className: used > total ? "bad" : undefined },
          ...(dead > 0 ? [{ label: "Dead money", value: millions(dead), className: "sm" }] : []),
        ]}
      />

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}
      {/* "5 signed" over a roster that went from 25 to 53: the staff's fill
          was on the wire and nowhere on the screen about this market */}
      {staffFill && (
        <div className="notice" role="status">
          {/* the wire's line names the team for everyone else; on your own
              summary it is your staff */}
          {staffFill.summary.replace(/^.*?'s staff /, "Your staff ")}
        </div>
      )}
      {!staffFill && s.stage === "freeAgencySummary" && s.staffFill?.season === s.season && (s.staffFill.byTeam[code]?.length ?? 0) > 0 && (
        <div className="notice" role="status">
          {(() => {
            const names = s.staffFill!.byTeam[code]!;
            const shown = names.length > 5 ? [...names.slice(0, 5), `${names.length - 5} more`] : names;
            return `Your staff signed ${andList(shown)} after free agency, to fill out the roster.`;
          })()}
        </div>
      )}

      <Tabs
        tabs={[
          { id: "yours", label: "Your Results" },
          { id: "league", label: "League Signings" },
          { id: "pool", label: "Remaining Pool" },
          {
            id: "budget",
            label: legal ? "Roster & Budget" : `Roster & Budget (${issues.length})`,
          },
        ]}
        active={active}
        onChange={setActive}
        label="Free agency summary"
      />

      <Panel id="yours" open={active === "yours"}>
        <p className="subhead" style={{ marginTop: 0 }}>
          Signed ({mySignings.length})
        </p>
        {mySignings.length === 0 ? (
          <div className="emptystate">You didn&rsquo;t sign anybody.</div>
        ) : (
          mySignings.map((sig, i) => {
            const p = s.players[sig.playerId];
            return (
              <div key={`${sig.playerId}-${i}`} className="lobby-row">
                <div>
                  <p className="pname">
                    {p?.name ?? sig.playerId}
                    <span className="ppos">{p?.position}</span>
                  </p>
                  <p className="lobby-sub">
                    Round {sig.round} · {millions(sig.salary)}/yr × {sig.years}y
                  </p>
                </div>
                <div className="lobby-actions">{p && <OvrPill value={p.overall} />}</div>
              </div>
            );
          })
        )}

        {/* a GM who passed every round got "Went elsewhere (0) — nobody you
            bid on went elsewhere" under "you didn't sign anybody" */}
        {(mySignings.length > 0 || myLostBids.length > 0) && (
          <p className="subhead">Went elsewhere ({myLostBids.length})</p>
        )}
        {myLostBids.length === 0 ? (
          mySignings.length > 0 && <div className="emptystate">Nobody you bid on went elsewhere.</div>
        ) : (
          myLostBids.map((playerId) => {
            const p = s.players[playerId];
            const won = e.signed.find((x) => x.playerId === playerId)!;
            return (
              <div key={playerId} className="lobby-row">
                <div>
                  <p className="pname">
                    {p?.name ?? playerId}
                    <span className="ppos">{p?.position}</span>
                  </p>
                  <p className="lobby-sub">
                    Went to {TEAMS_BY_CODE[won.teamCode]?.label ?? won.teamCode} ·{" "}
                    {millions(won.salary)}/yr × {won.years}y
                    {(() => {
                      // A player picks the best fit for what he wants, not
                      // just the most money — a $3.5M offer "outbid" by
                      // $3.2M read as a bug. Say which it was.
                      const mine = (e.offers[playerId] ?? []).find((o) => o.teamCode === code);
                      if (!mine || !p || mine.salary <= won.salary) return null;
                      return ` — he took less to get ${PRIMARY_VALUE_LABEL[primaryValueOf(p)].toLowerCase()}`;
                    })()}
                  </p>
                </div>
                <div className="lobby-actions">
                  <TeamBadge code={won.teamCode} size={22} />
                </div>
              </div>
            );
          })
        )}
      </Panel>

      <Panel id="league" open={active === "league"}>
        {e.signed.length === 0 ? (
          <div className="emptystate">Nobody signed anywhere.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="stbl">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="c">Pos</th>
                  <th>Team</th>
                  <th className="c">Salary</th>
                  <th className="c">Yrs</th>
                  <th className="c">Rd</th>
                </tr>
              </thead>
              <tbody>
                {e.signed.map((sig, i) => {
                  const p = s.players[sig.playerId];
                  return (
                    <tr key={`${sig.playerId}-${i}`} className={sig.teamCode === code ? "highlight" : ""}>
                      <td className="name">{p?.name ?? sig.playerId}</td>
                      <td className="c">{p?.position}</td>
                      <td>{TEAMS_BY_CODE[sig.teamCode]?.abbr ?? sig.teamCode}</td>
                      <td className="c">{millions(sig.salary)}</td>
                      <td className="c">{sig.years}</td>
                      <td className="c">{sig.round}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel id="pool" open={active === "pool"}>
        <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-faint)" }}>
          Still unsigned. They stay in the league-wide pool and are available again later.
        </p>
        {unsignedPool(s)
          .sort((a, b) => b.overall - a.overall)
          .slice(0, 60)
          .map((p) => (
            <div key={p.id} className="lobby-row">
              <div>
                <p className="pname">
                  {p.name}
                  <span className="ppos">{p.position}</span>
                </p>
                <p className="lobby-sub">
                  Age {p.age} · was asking {millions(expectedSalary(p))}/yr
                </p>
              </div>
              <div className="lobby-actions">
                <OvrPill value={p.overall} />
              </div>
            </div>
          ))}
      </Panel>

      <Panel id="budget" open={active === "budget"}>
        {legal ? (
          <div className="notice" role="status">
            <strong>You&rsquo;re legal.</strong> Under the cap, within the roster limit, and
            covered at every position.
            {/* "29 / 53" in the ticker read as a problem to solve here */}
            {s.stage === "freeAgencySummary" && roster.length < ROSTER_SIZE && (
              <>
                {" "}
                Short of {ROSTER_SIZE} is fine: your staff fills the rest with minimum-salary depth
                when the preseason starts.
              </>
            )}
            {/* the ticker's cap space counts dead money and can be red here */}
            {booked > total && (
              <>
                {" "}
                Your cap space reads {millions(Math.round((total - booked) * 10) / 10)} because it includes{" "}
                {millions(dead)} of dead money, which doesn&rsquo;t count toward the limit — but you
                can&rsquo;t sign anyone until you&rsquo;re back under.
              </>
            )}
          </div>
        ) : (
          <div className="notice bad" role="status">
            <strong>Not ready to advance.</strong>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {issues.map((i, n) => (
                <li key={n} style={{ marginBottom: 3 }}>
                  {i.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="subhead">
          Your roster ({roster.length}){overLimitOnly ? " · weakest first" : ""}
        </p>
        {roster
          .slice()
          // biggest contracts first answers the cap; a GM one over 53 and under
          // the cap wants the fringe players, which sat 54 rows down on a phone
          .sort((a, b) =>
            overLimitOnly
              ? a.overall - b.overall
              : (b.contract?.cap_hit_by_year[0] ?? 0) - (a.contract?.cap_hit_by_year[0] ?? 0),
          )
          .map((p) => {
            const can = checkRelease(s, code, p.id);
            return (
              <div key={p.id} className="lobby-row">
                <div>
                  <p className="pname">
                    {p.name}
                    <span className="ppos">{p.position}</span>
                  </p>
                  <p className="lobby-sub">
                    {millions(p.contract?.cap_hit_by_year[0] ?? 0)}/yr ·{" "}
                    {p.contract?.years_remaining ?? 0}y left
                    {/* both halves: what it frees, and the dead money it leaves */}
                    {can.ok
                      ? ` · releasing frees ${millions(Math.round(((p.contract?.cap_hit_by_year[0] ?? 0) - releasePenalty(p)) * 10) / 10)} (${millions(releasePenalty(p))} dead)`
                      : ` · ${can.reason}`}
                    {can.ok && lastBackup(p.position) && (
                      <strong style={{ color: "var(--bad)" }}> · leaves no backup {p.position}</strong>
                    )}
                  </p>
                </div>
                <div className="lobby-actions">
                  <OvrPill value={p.overall} />
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={!can.ok || busy}
                    onClick={() => {
                      if (!confirm(`Release ${p.name}? It leaves ${millions(releasePenalty(p))} of dead money and can't be undone.`)) return;
                      release(p.id);
                    }}
                  >
                    Release
                  </button>
                </div>
              </div>
            );
          })}
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          {legal
            ? "Advancing is final — you can't come back to free agency."
            : "Fix everything on Roster & Budget before you can advance."}
        </span>
        {!legal && code && (
          // A signed draft class puts every team at ~60 each offseason, and
          // getting back to 53 meant seven separate releases by hand. The
          // staff cuts the way the CPU teams do: spare bodies at crowded
          // positions first, then the lowest-rated, never a starter to save
          // money if a backup will do.
          <button
            type="button"
            className="btnlink"
            disabled={trimming}
            onClick={() => {
              // planned on a copy, shown before anything goes — releases
              // can't be undone and cost dead money
              const cuts = planStaffTrim(useStore.getState(), code);
              const short = issues.some((i) => i.kind === "position");
              const cost = Math.round(cuts.reduce((n, p) => n + releasePenalty(p), 0) * 10) / 10;
              const list = cuts.map((p) => `${p.name} (${p.position} ${p.overall})`).join(", ");
              const plan = [
                cuts.length > 0 ? `release ${list} — ${millions(cost)} of dead money` : "",
                // a hole at a position can't be cut away: the staff signs a
                // street free agent into it, as it does for the CPU teams
                short ? "sign a one-year minimum free agent into each empty position" : "",
              ].filter(Boolean);
              if (plan.length > 0 && !confirm(`Your staff would ${plan.join(", and ")}. Go ahead?`)) return;
              setTrimming(true);
              setTrimNote(null);
              const had = new Set(rosterOf(useStore.getState(), code).map((p) => p.id));
              void actions
                .staffFix()
                .then((res) => {
                  const now = rosterOf(useStore.getState(), code);
                  const gone = [...had].filter((id) => !now.some((p) => p.id === id)).map((id) => useStore.getState().players[id]);
                  const added = now.filter((p) => !had.has(p.id));
                  const parts: string[] = [];
                  if (gone.length > 0) parts.push(`Your staff released ${gone.map((p) => (p ? `${p.name} (${p.position} ${p.overall})` : "a player")).join(", ")}.`);
                  if (added.length > 0) parts.push(`It signed ${added.map((p) => `${p.name} (${p.position} ${p.overall})`).join(", ")}.`);
                  if (!res.ok) parts.push(res.reason ?? "The staff couldn't finish.");
                  setTrimNote(parts.join(" ") || null);
                })
                .finally(() => setTrimming(false));
            }}
          >
            {trimming ? "Fixing…" : "Let my staff fix the roster"}
          </button>
        )}
      </Footer>
      {trimNote && (
        <p className="notice" role="status" style={{ marginTop: 10 }}>
          {trimNote}
        </p>
      )}
      <ReadinessGate
        title="Free agency summary readiness"
        onAdvance={(r) => nav(r)}
        disabled={!legal}
        disabledHint="Roster not legal"
      />
    </Card>
  );
}
