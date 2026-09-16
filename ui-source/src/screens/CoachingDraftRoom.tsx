import { useMemo, useState } from "react";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Coach, CoachRole } from "@/domain";
import { COACH_POSITION_GROUPS, COACH_ROLES, COACH_ROLE_LABEL, SCHEME_LABEL } from "@/domain";
import {
  availableCoaches,
  coachingOnTheClock,
  ratingOf,
  vacantRoles,
} from "@/state/coachingDraft";
import { viewerTeamCode } from "@/state/selectors";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

/**
 * The coaching fantasy draft.
 *
 * Twelve rounds, snake order, opening with the exact reverse of player-draft
 * round 1 — so the GM who took the best player takes the last coach. Every
 * pick is made by hand; there is no threshold and no simulated remainder,
 * because a staff is twelve decisions and automating eleven of them would
 * leave the stage without a point.
 *
 * The board is deliberately "any available candidate for any job you have not
 * filled" rather than a fixed role per round. That is what makes the snake
 * bite: taking the best quarterbacks coach now means living with whoever is
 * left at linebackers later, and which of those hurts less is the GM's call.
 */
export function CoachingDraftRoom() {
  const s = useStore();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const { active, setActive } = useTabs("board");
  const [roleFilter, setRoleFilter] = useState<"ALL" | CoachRole>("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = s.coachingDraft;
  const onClock = coachingOnTheClock(s);
  const yourPick = !!code && onClock === code;
  const mine = useMemo(
    () => (code ? vacantRoles(s, code) : []),
    [s.coaches, code], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const openVacancies = new Set(mine);

  const board = useMemo(() => {
    const open = availableCoaches(s);
    return open
      .filter((c) => roleFilter === "ALL" || c.role === roleFilter)
      .sort((a, b) => ratingOf(b) - ratingOf(a));
  }, [s.coaches, roleFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft || !code) {
    return (
      <Card>
        <CardHeader badge="CD" title="Coaching Draft" subtitle="Setting the board" />
        <div className="panel open">
          <div className="emptystate">One moment.</div>
        </div>
      </Card>
    );
  }

  const teams = Object.keys(s.teams).length;
  const round = Math.floor(draft.currentPickIndex / teams) + 1;
  const pickInRound = (draft.currentPickIndex % teams) + 1;
  const staff = Object.values(s.coaches).filter((c) => c.team === code);

  const take = (coachId: string): void => {
    setBusy(true);
    setError(null);
    void actions
      .draftCoach(coachId)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "That pick didn't go through.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <Card maxWidth={900}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Coaching Draft"
        subtitle={`Round ${round} of 12 · pick ${pickInRound} of ${teams}`}
        right={
          <>
            <p>{yourPick ? "You're on the clock" : "On the clock"}</p>
            <p>{onClock ? TEAMS_BY_CODE[onClock]?.label ?? onClock : "Draft complete"}</p>
          </>
        }
      />
      <Ticker
        stats={[
          { label: "Your staff", value: `${12 - mine.length} / 12` },
          { label: "Still to fill", value: mine.length },
          { label: "Available", value: availableCoaches(s).length },
          {
            label: "Order",
            value: "Reverse of the player draft",
            className: "sm",
          },
        ]}
      />

      {error && (
        <div className="notice bad" role="status">
          {error}
        </div>
      )}

      <Tabs
        tabs={[
          { id: "board", label: "Available" },
          { id: "staff", label: `Your Staff (${12 - mine.length})` },
          { id: "picks", label: "Recent Picks" },
        ]}
        active={active}
        onChange={setActive}
        label="Coaching draft"
      />

      <Panel id="board" open={active === "board"}>
        <div className="rolefilter">
          <button
            type="button"
            className={roleFilter === "ALL" ? "active" : ""}
            onClick={() => setRoleFilter("ALL")}
          >
            All
          </button>
          {COACH_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className={roleFilter === r ? "active" : ""}
              // a job you have filled is not a job you can draft for
              disabled={!openVacancies.has(r)}
              onClick={() => setRoleFilter(r)}
            >
              {r}
            </button>
          ))}
        </div>

        {!yourPick && (
          <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-faint)" }}>
            Waiting for {onClock ? TEAMS_BY_CODE[onClock]?.label ?? onClock : "the league"} to pick.
            You can look around in the meantime.
          </p>
        )}

        {board.length === 0 ? (
          <div className="emptystate">Nobody left at that job.</div>
        ) : (
          board.slice(0, 60).map((c) => (
            <CoachRow
              key={c.id}
              coach={c}
              canTake={yourPick && openVacancies.has(c.role) && !busy}
              onTake={() => take(c.id)}
            />
          ))
        )}
      </Panel>

      <Panel id="staff" open={active === "staff"}>
        {COACH_ROLES.map((role) => {
          const hire = staff.find((c) => c.role === role);
          return (
            <div key={role} className="lobby-row">
              <div>
                <p className="pname">
                  {hire ? hire.name : <span style={{ color: "var(--ink-faint)" }}>Vacant</span>}
                  <span className="ppos">{role}</span>
                </p>
                <p className="lobby-sub">{COACH_ROLE_LABEL[role]}</p>
              </div>
              <div className="lobby-actions">
                {hire && <span className="ovrpill">{ratingOf(hire)}</span>}
              </div>
            </div>
          );
        })}
      </Panel>

      <Panel id="picks" open={active === "picks"}>
        {draft.results.length === 0 ? (
          <div className="emptystate">No picks yet.</div>
        ) : (
          [...draft.results]
            .slice(-40)
            .reverse()
            .map((r, i) => {
              const c = s.coaches[r.coachId];
              return (
                <div key={`${r.coachId}-${i}`} className="lobby-row">
                  <div>
                    <p className="pname">
                      {c?.name ?? r.coachId}
                      <span className="ppos">{r.role}</span>
                    </p>
                    <p className="lobby-sub">
                      Round {r.round} · {TEAMS_BY_CODE[r.teamCode]?.label ?? r.teamCode}
                    </p>
                  </div>
                  <div className="lobby-actions">
                    <TeamBadge code={r.teamCode} size={22} />
                  </div>
                </div>
              );
            })
        )}
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Every one of the twelve is picked by hand. The draft ends when the last job in the league
          is filled, and everyone moves to the summary together.
        </span>
      </Footer>
    </Card>
  );
}

/** One candidate. What matters about a coach depends on which kind he is. */
function CoachRow({
  coach,
  canTake,
  onTake,
}: {
  coach: Coach;
  canTake: boolean;
  onTake: () => void;
}) {
  const group = COACH_POSITION_GROUPS[coach.role as keyof typeof COACH_POSITION_GROUPS];
  return (
    <div className="lobby-row">
      <div>
        <p className="pname">
          {coach.name}
          <span className="ppos">{coach.role}</span>
        </p>
        <p className="lobby-sub">
          {COACH_ROLE_LABEL[coach.role]}
          {coach.scheme ? ` · ${SCHEME_LABEL[coach.scheme]}` : ""}
          {group && group.length > 0 ? ` · develops ${group.join(", ")}` : ""}
          {coach.role === "MED" ? " · injury recovery for everyone" : ""}
        </p>
      </div>
      <div className="lobby-actions">
        <span className="ovrpill">{ratingOf(coach)}</span>
        <button type="button" className="btn-primary" disabled={!canTake} onClick={onTake}>
          Draft
        </button>
      </div>
    </div>
  );
}
