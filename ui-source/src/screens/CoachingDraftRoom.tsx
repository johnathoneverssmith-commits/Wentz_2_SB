import { CommissionerTakeTurn } from "@/components/CommissionerTakeTurn";
import { StageLoading } from "@/components/StageLoading";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { pressable, TeamBadge } from "@/components/bits";
import { CoachDetailsModal } from "@/components/CoachDetailsModal";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Coach, CoachRole } from "@/domain";
import { COACH_POSITION_GROUPS, COACH_ROLES, COACH_ROLE_LABEL, SCHEME_LABEL } from "@/domain";
import {
  availableCoaches,
  suggestedCoachingPick,
  coachingOnTheClock,
  COACHING_ROUNDS,
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
  const nav = useNavigate();
  const actions = useLeagueActions();
  const code = viewerTeamCode(s);
  const { active, setActive } = useTabs("board");
  const [roleFilter, setRoleFilter] = useState<"ALL" | CoachRole>("ALL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<Coach | null>(null);
  // the guard itself: busy state lags a render, so two clicks both went out
  const taking = useRef(false);

  // the board completes itself once the last job in the league is filled
  // (store.ts's draftCoach) and moves the stage on with it — nothing here
  // asks the player to confirm that, so the screen has to leave on its own.
  useEffect(() => {
    if (s.stage !== "coachingDraft") nav("/", { replace: true });
  }, [s.stage, nav]);

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
      // Only jobs this staff still has open. A coach whose role is already
      // filled has his Draft button disabled anyway, so listing him puts dead
      // rows at the top of a list sorted by rating — by the sixth round the
      // best hire you can actually make is below a greyed-out head coach. The
      // role chips above already refuse a filled role outright
      // (`disabled={!openVacancies.has(r)}`); this is the same rule applied to
      // the board they filter.
      .filter((c) => openVacancies.has(c.role))
      .sort((a, b) => ratingOf(b) - ratingOf(a));
  }, [s.coaches, roleFilter, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft || !code) {
    return (
      <Card>
        <CardHeader badge="CD" title="Coaching Draft" subtitle="Setting the board" />
        <div className="panel open">
          <StageLoading />
        </div>
      </Card>
    );
  }

  const teams = Object.keys(s.teams).length;
  // `currentPickIndex` reaches `teams * COACHING_ROUNDS` once the last pick is
  // made, which is one pick past the last real round — clamp the display so
  // a finished draft reads "Round 12 of 12", not "Round 13 of 12".
  const round = Math.min(Math.floor(draft.currentPickIndex / teams) + 1, COACHING_ROUNDS);
  const pickInRound = (draft.currentPickIndex % teams) + 1;
  const staff = Object.values(s.coaches).filter((c) => c.team === code);

  const take = (coachId: string): void => {
    if (taking.current) return;
    taking.current = true;
    setBusy(true);
    setError(null);
    void actions
      .draftCoach(coachId)
      .then((res) => {
        if (!res.ok) setError(res.reason ?? "That pick didn't go through.");
      })
      .finally(() => {
        taking.current = false;
        setBusy(false);
      });
  };
  const clockGm = s.gms.find((g) => g.isHuman && g.teamCode === onClock)?.name;
  const nextMine = draft.pickOrder.indexOf(code, draft.currentPickIndex);
  const picksAway = nextMine < 0 ? null : nextMine - draft.currentPickIndex;

  return (
    <Card maxWidth={900}>
      <CardHeader
        badge={TEAMS_BY_CODE[code]!.abbr}
        title="Coaching Draft"
        subtitle={`Round ${round} of ${COACHING_ROUNDS} · pick ${pickInRound} of ${teams}`}
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
        {yourPick &&
          (() => {
            // twelve rounds a season is a lot of clicking — the same
            // suggestion the player draft offers. Not the CPU's own pick:
            // that one carries the difficulty setting's evaluation noise.
            // the best value among your open jobs — a thin job's best coach
            // over a deep one's (`coachingPickValue`)
            const c = suggestedCoachingPick(s, code);
            if (!c) return null;
            return (
              <div
                className="team-callout"
                style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
                role="status"
              >
                <span style={{ flex: 1, minWidth: 200 }}>
                  You're on the clock — best value for your open jobs:{" "}
                  <strong style={{ color: "var(--ink)" }}>{c.name}</strong>{" "}
                  <span style={{ color: "var(--ink-dim)", fontWeight: 500 }}>
                    ({COACH_ROLE_LABEL[c.role]}, {ratingOf(c)})
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ fontSize: 11.5, padding: "7px 12px" }}
                  disabled={busy}
                  onClick={() => take(c.id)}
                >
                  Hire {c.name}
                </button>
              </div>
            );
          })()}
        <div className="rolefilter">
          <button
            type="button"
            className={roleFilter === "ALL" ? "active" : ""}
            aria-pressed={roleFilter === "ALL"}
            onClick={() => setRoleFilter("ALL")}
          >
            All
          </button>
          {COACH_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              className={roleFilter === r ? "active" : ""}
              aria-pressed={roleFilter === r}
              // "MED", "DC", "ST" read aloud as letters
              aria-label={COACH_ROLE_LABEL[r]}
              title={COACH_ROLE_LABEL[r]}
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
            Waiting for{" "}
            {onClock
              ? clockGm
                ? `${clockGm} (${TEAMS_BY_CODE[onClock]?.label ?? onClock})`
                : (TEAMS_BY_CODE[onClock]?.label ?? onClock)
              : "the league"}{" "}
            to pick.
            {picksAway != null && (picksAway === 1 ? " You pick next." : ` Your pick is ${picksAway} picks away.`)} You can look
            around in the meantime.
            <CommissionerTakeTurn team={onClock} />
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
              onInspect={() => setInspect(c)}
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
                  {hire ? (
                    <span
                      {...pressable(() => setInspect(hire))}
                      style={{ textDecoration: "underline", textDecorationColor: "var(--line-strong)", cursor: "pointer" }}
                    >
                      {hire.name}
                    </span>
                  ) : (
                    <span style={{ color: "var(--ink-faint)" }}>Vacant</span>
                  )}
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
                      {c ? (
                        <span
                          {...pressable(() => setInspect(c))}
                          style={{ textDecoration: "underline", textDecorationColor: "var(--line-strong)", cursor: "pointer" }}
                        >
                          {c.name}
                        </span>
                      ) : (
                        r.coachId
                      )}
                      <span className="ppos">{r.role}</span>
                    </p>
                    <p className="lobby-sub">
                      Round {r.round} · {TEAMS_BY_CODE[r.teamCode]?.label ?? r.teamCode}
                      {/* a GM's pick, not the CPU's — as on the player draft board */}
                      {(() => {
                        const gm = s.gms.find((g) => g.isHuman && g.teamCode === r.teamCode)?.name;
                        return gm ? ` · ${gm}` : "";
                      })()}
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

      {inspect && <CoachDetailsModal coach={inspect} onClose={() => setInspect(null)} />}
    </Card>
  );
}

/** One candidate. What matters about a coach depends on which kind he is. */
function CoachRow({
  coach,
  canTake,
  onTake,
  onInspect,
}: {
  coach: Coach;
  canTake: boolean;
  onTake: () => void;
  onInspect: () => void;
}) {
  const group = COACH_POSITION_GROUPS[coach.role as keyof typeof COACH_POSITION_GROUPS];
  return (
    <div className="lobby-row">
      <div>
        <p className="pname">
          <span
            {...pressable(onInspect)}
            style={{ textDecoration: "underline", textDecorationColor: "var(--line-strong)", cursor: "pointer" }}
          >
            {coach.name}
          </span>
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
        <button type="button" className="btn-primary" disabled={!canTake} onClick={onTake} aria-label={`Draft ${coach.name}`}>
          Draft
        </button>
      </div>
    </div>
  );
}
