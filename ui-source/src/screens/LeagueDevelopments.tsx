import { useNavigate } from "react-router-dom";

import { ReadinessGate } from "@/components/ReadinessGate";
import { StagePage } from "@/components/stages/StagePage";
import { viewerTeamCode } from "@/state/selectors";
import { TEAMS_BY_CODE } from "@/data/teams";
import { leagueDevelopmentsFor, swindleLineFor, type LeagueDevelopmentEntry } from "@/state/hoodedFigure";
import type { CoachingChange } from "@/state/coachingCarousel";
import { useStore } from "@/state/store";
import { millions, posLabel } from "@/util/format";

function teamName(code: string): string {
  return TEAMS_BY_CODE[code]?.name ?? code;
}

/**
 * League-wide, post-preseason offseason news (spec §25).
 *
 * Every human sees the exact same list in the exact same order — deterministic
 * by tier then team code, never personalized — because this is the one place
 * the hooded-figure mechanic is allowed to surface at all, and only for the
 * swindle case. Everything else here reads like ordinary league news.
 */
function EntryCard({ e, season }: { e: LeagueDevelopmentEntry; season: number }) {
  const coaches = useStore((st) => st.coaches);
  if (e.kind === "swindle") {
    return (
      <div className="stage-entry stage-entry--swindle">
        <p className="stage-entry-lead">
          ***{e.swindleGmName} gave {millions(e.swindlePayment ?? 0)} to a hooded figure.
        </p>
        <p className="stage-text">
          {swindleLineFor(e.teamCode, season)}
        </p>
      </div>
    );
  }

  const o = e.outcome;
  if (!o) return null;

  return (
    <div className="stage-entry">
      <h3 className="stage-entry-team">{teamName(e.teamCode)}</h3>
      <p className="stage-entry-lead">{o.publicText}</p>

      {o.playerChanges && o.playerChanges.length > 0 && (
        <div className="stage-lines">
          {o.playerChanges.map((c) => (
            <div key={c.playerId}>
              <strong>{c.name}</strong> — {posLabel(c.position)} — OVR {c.before} → <strong>{c.after}</strong>
            </div>
          ))}
        </div>
      )}

      {o.negativePlayers && o.negativePlayers.length > 0 && (
        <div className="stage-lines">
          {o.negativePlayers.map((p) => (
            <div key={p.playerId}>
              <strong>{p.name}</strong> — {posLabel(p.position)} — OVR {p.overall}
              <br />
              <span className="stage-mute">
                Unavailable: {o.absenceWeeks == null ? "rest of season" : `${o.absenceWeeks} week${o.absenceWeeks === 1 ? "" : "s"}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {o.coachFired && (
        <p className="stage-text">
          {(() => {
            const next = Object.values(coaches).find((c) => c.team === e.teamCode && c.role === "HC");
            return next ? `${next.name} takes over as head coach.` : "The team is looking for a new head coach.";
          })()}
        </p>
      )}
      {o.wholeRosterOut && (
        <p className="stage-text">
          Kicker and punter excepted — everyone else is out for the season.
        </p>
      )}
    </div>
  );
}

export function LeagueDevelopments() {
  const s = useStore();
  const nav = useNavigate();
  const entries = leagueDevelopmentsFor(s);
  const carousel = (s.coachingChanges ?? []).filter((c) => c.season === s.season - 1);
  const hallOfFame = (s.hallOfFame ?? []).some((h) => h.inducted === s.season - 1);

  return (
    <StagePage
      code={viewerTeamCode(s)}
      kicker="League developments"
      heading="League news"
      sub={`${s.season} preseason wrap-up`}
    >
      <div className="stage-feed">
        {entries.length === 0 ? (
          // quiet only if nothing below says otherwise
          carousel.length === 0 && !hallOfFame ? (
            <div className="emptystate">A quiet offseason around the league.</div>
          ) : null
        ) : (
          entries.map((e, i) => <EntryCard key={`${e.teamCode}-${i}`} e={e} season={s.season} />)
        )}
      </div>
      <CoachingCarousel changes={carousel} />
      {hallOfFame && (
        <section className="stage-entry stage-lines">
          <h2 className="stage-h">Hall of Fame class of {s.season - 1}</h2>
          {(s.hallOfFame ?? [])
            .filter((h) => h.inducted === s.season - 1)
            .map((h) => (
              <div key={h.playerId}>
                <strong>{h.name}</strong>{" "}
                <span className="stage-mute">
                  {posLabel(h.position)} · {h.seasons} seasons · {h.why}
                </span>
              </div>
            ))}
        </section>
      )}
      <ReadinessGate
        title="League developments readiness"
        label="Continue to the Regular Season"
        onAdvance={(r) => nav(r)}
      />
    </StagePage>
  );
}

const ROLE_LABEL: Record<string, string> = { HC: "head coach", OC: "offensive coordinator", DC: "defensive coordinator" };

/** The offseason's CPU staff moves — who was let go, and who replaced him. */
function CoachingCarousel({ changes }: { changes: CoachingChange[] }) {
  if (changes.length === 0) return null;
  return (
    <section className="stage-entry stage-lines">
      <h2 className="stage-h">Coaching carousel</h2>
      {changes.map((c, i) => (
        <div key={`${c.team}-${c.role}-${i}`}>
          <strong>{teamName(c.team)}</strong>{" "}
          {c.departed ? (
            <>
              {c.reason === "fired" ? "fired" : "parted ways with"} {ROLE_LABEL[c.role]} {c.departed}
            </>
          ) : (
            <>filled an open {ROLE_LABEL[c.role]} job</>
          )}
          {c.hired ? <> · hired {c.hired}</> : <> · the job is open</>}
        </div>
      ))}
    </section>
  );
}
