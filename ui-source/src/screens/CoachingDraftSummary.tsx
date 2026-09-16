import { useMemo, useState } from "react";

import { TeamBadge } from "@/components/bits";
import { Card, CardHeader, Footer, Panel, Tabs, Ticker, useTabs } from "@/components/primitives";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Coach, CoachRole } from "@/domain";
import { COACH_POSITION_GROUPS, COACH_ROLES, COACH_ROLE_LABEL, SCHEME_LABEL } from "@/domain";
import { ratingOf } from "@/state/coachingDraft";
import {
  developmentMultiplier,
  recoveryMultiplier,
  regressionMultiplier,
} from "@/state/coachEffects";
import { viewerTeamCode } from "@/state/selectors";
import { rankBy, staffCards } from "@/state/staffRatings";
import { useStore } from "@/state/store";
import { useLeagueActions } from "@/state/useLeagueActions";

/**
 * What everybody ended up with.
 *
 * The per-team tabs exist because a staff is twelve hires and a GM who just
 * made them wants to see them together, with what each one actually does
 * spelled out rather than implied by a rating. The comparison table exists
 * because the interesting question after a draft is not "is my staff good" but
 * "is it better than theirs", and that only reads off a league-wide table.
 *
 * Grades come from the same rank-to-letter logic the player summary uses, so
 * a B+ staff and a B+ roster mean the same thing.
 */
const gradeFor = (rank: number, of: number): string => {
  const pct = rank / of;
  if (pct <= 0.06) return "A+";
  if (pct <= 0.16) return "A";
  if (pct <= 0.28) return "A-";
  if (pct <= 0.38) return "B+";
  if (pct <= 0.5) return "B";
  if (pct <= 0.62) return "B-";
  if (pct <= 0.72) return "C+";
  if (pct <= 0.84) return "C";
  if (pct <= 0.94) return "C-";
  return "D";
};

const pct = (multiplier: number): string => {
  const v = Math.round((multiplier - 1) * 100);
  return v === 0 ? "—" : `${v > 0 ? "+" : ""}${v}%`;
};

export function CoachingDraftSummary() {
  const s = useStore();
  const actions = useLeagueActions();
  const mine = viewerTeamCode(s);
  const humanTeams = s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode);
  const { active, setActive } = useTabs(mine ?? humanTeams[0] ?? "league");
  const [committing, setCommitting] = useState(false);

  const cards = useMemo(() => staffCards(s), [s.coaches, s.teams]); // eslint-disable-line react-hooks/exhaustive-deps
  const overallRank = useMemo(() => rankBy(cards, "overall"), [cards]);
  const offenseRank = useMemo(() => rankBy(cards, "offense"), [cards]);
  const defenseRank = useMemo(() => rankBy(cards, "defense"), [cards]);
  const hcRank = useMemo(() => rankBy(cards, "headCoach"), [cards]);
  const stRank = useMemo(() => rankBy(cards, "specialTeams"), [cards]);
  const medRank = useMemo(() => rankBy(cards, "medical"), [cards]);

  const teams = cards.length;
  const myCard = cards.find((c) => c.teamCode === mine);

  return (
    <Card maxWidth={960}>
      <CardHeader
        badge="CD"
        title="Coaching Draft Summary"
        subtitle={`${s.season} staffs · every job filled`}
      />
      <Ticker
        stats={[
          { label: "Your staff OVR", value: myCard?.overall ?? "—" },
          {
            label: "League rank",
            value: mine ? `${overallRank.get(mine)} of ${teams}` : "—",
            className: "sm",
          },
          { label: "Offense", value: mine ? `${offenseRank.get(mine)}th` : "—", className: "sm" },
          { label: "Defense", value: mine ? `${defenseRank.get(mine)}th` : "—", className: "sm" },
        ]}
      />

      <Tabs
        tabs={[
          ...humanTeams.map((t) => ({
            id: t,
            label: t === mine ? "Your Staff" : TEAMS_BY_CODE[t]?.abbr ?? t,
          })),
          { id: "league", label: "Every Team" },
        ]}
        active={active}
        onChange={setActive}
        label="Coaching summary"
      />

      {humanTeams.map((team) => (
        <Panel key={team} id={team} open={active === team}>
          <StaffDetail teamCode={team} />
        </Panel>
      ))}

      <Panel id="league" open={active === "league"}>
        <div style={{ overflowX: "auto" }}>
          <table className="stbl">
            <thead>
              <tr>
                <th>Team</th>
                <th className="c">Staff OVR</th>
                <th className="c">HC</th>
                <th className="c">Off</th>
                <th className="c">Def</th>
                <th className="c">ST</th>
                <th className="c">Med</th>
                <th className="c">Grade</th>
              </tr>
            </thead>
            <tbody>
              {[...cards]
                .sort((a, b) => b.overall - a.overall)
                .map((c) => {
                  const isMine = c.teamCode === mine;
                  return (
                    <tr key={c.teamCode} style={isMine ? { background: "var(--panel-sunken)" } : undefined}>
                      <td className="name">
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                          <TeamBadge code={c.teamCode} size={18} />
                          {TEAMS_BY_CODE[c.teamCode]?.label ?? c.teamCode}
                          {isMine && <span className="ppos">you</span>}
                        </span>
                      </td>
                      <td className="c" style={{ fontWeight: 700 }}>{c.overall}</td>
                      <td className="c">{hcRank.get(c.teamCode)}</td>
                      <td className="c">{offenseRank.get(c.teamCode)}</td>
                      <td className="c">{defenseRank.get(c.teamCode)}</td>
                      <td className="c">{stRank.get(c.teamCode)}</td>
                      <td className="c">{medRank.get(c.teamCode)}</td>
                      <td className="c" style={{ fontWeight: 700 }}>
                        {gradeFor(overallRank.get(c.teamCode) ?? teams, teams)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.6 }}>
          Staff OVR is a weighted average of all twelve, head coach counting triple and the
          coordinators double. The offensive and defensive columns are ranks within their own
          composite and exclude the head coach, who is already the heaviest part of the overall.
        </p>
      </Panel>

      <Footer>
        <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink-faint)", alignSelf: "center" }}>
          Advancing is final — you can&rsquo;t come back to this summary.
        </span>
        <button
          type="button"
          className="btn-primary"
          disabled={committing}
          onClick={() => {
            if (!confirm("Advance to Free Agency? You can't return to this summary.")) return;
            setCommitting(true);
            void actions
              .readyUp(true)
              .then((res) => {
                if (!res.ok) alert(res.reason ?? "Couldn't advance.");
              })
              .finally(() => setCommitting(false));
          }}
        >
          {committing ? "Advancing…" : "Advance to Free Agency"}
        </button>
      </Footer>
    </Card>
  );
}

/** One team's twelve, with what each of them is actually worth. */
function StaffDetail({ teamCode }: { teamCode: string }) {
  const s = useStore();
  const staff = Object.values(s.coaches).filter((c) => c.team === teamCode);
  const byRole = new Map(staff.map((c) => [c.role, c]));

  return (
    <>
      <p className="subhead" style={{ marginTop: 0 }}>
        {TEAMS_BY_CODE[teamCode]?.label ?? teamCode}
      </p>
      {COACH_ROLES.map((role) => {
        const c = byRole.get(role);
        if (!c) {
          return (
            <div key={role} className="lobby-row">
              <div>
                <p className="pname">
                  <span style={{ color: "var(--ink-faint)" }}>Vacant</span>
                  <span className="ppos">{role}</span>
                </p>
                <p className="lobby-sub">{COACH_ROLE_LABEL[role]}</p>
              </div>
            </div>
          );
        }
        return <CoachDetailRow key={role} coach={c} role={role} />;
      })}
    </>
  );
}

function CoachDetailRow({ coach, role }: { coach: Coach; role: CoachRole }) {
  const rating = ratingOf(coach);
  const group = COACH_POSITION_GROUPS[role as keyof typeof COACH_POSITION_GROUPS];

  // The three real ones keep their own characteristics; the nine added ones
  // are described by what they do to development, regression and recovery,
  // because a number alone does not tell a GM what he bought.
  const detail =
    role === "HC" ? (
      <>
        Game management {coach.gameManagement ?? "—"} · discipline {coach.discipline ?? "—"} ·
        aggression {coach.aggressiveness ?? "—"}
      </>
    ) : role === "OC" || role === "DC" ? (
      <>
        {coach.scheme ? SCHEME_LABEL[coach.scheme] : "—"} · play-calling {coach.playCallIq ?? "—"}
        {role === "OC" && coach.tendencyPassRate != null ? ` · pass ${coach.tendencyPassRate}%` : ""}
        {role === "DC" && coach.tendencyBlitzRate != null ? ` · blitz ${coach.tendencyBlitzRate}%` : ""}
      </>
    ) : role === "MED" ? (
      <>Injury recovery {pct(recoveryMultiplier(rating))} for every player</>
    ) : (
      <>
        {group?.join(", ")} · development {pct(developmentMultiplier(rating))} · regression{" "}
        {pct(regressionMultiplier(rating))}
      </>
    );

  return (
    <div className="lobby-row">
      <div>
        <p className="pname">
          {coach.name}
          <span className="ppos">{role}</span>
        </p>
        <p className="lobby-sub">
          {COACH_ROLE_LABEL[role]} — {detail}
        </p>
      </div>
      <div className="lobby-actions">
        <span className="ovrpill">{rating}</span>
      </div>
    </div>
  );
}
