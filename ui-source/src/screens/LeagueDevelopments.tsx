import { useNavigate } from "react-router-dom";

import { Card, CardHeader } from "@/components/primitives";
import { ReadinessGate } from "@/components/ReadinessGate";
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
      <div className="panel open" style={{ borderColor: "var(--bad)" }}>
        <p style={{ margin: 0, fontWeight: 700 }}>
          ***{e.swindleGmName} gave {millions(e.swindlePayment ?? 0)} to a hooded figure.
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--ink-faint)" }}>
          {swindleLineFor(e.teamCode, season)}
        </p>
      </div>
    );
  }

  const o = e.outcome;
  if (!o) return null;

  return (
    <div className="panel open">
      <p style={{ margin: 0, fontSize: 11, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: 1 }}>
        {teamName(e.teamCode)}
      </p>
      <p style={{ margin: "4px 0 0" }}>{o.publicText}</p>

      {o.playerChanges && o.playerChanges.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
          {o.playerChanges.map((c) => (
            <div key={c.playerId} style={{ fontSize: 12.5 }}>
              <strong>{c.name}</strong> — {posLabel(c.position)} — OVR {c.before} → <strong>{c.after}</strong>
            </div>
          ))}
        </div>
      )}

      {o.negativePlayers && o.negativePlayers.length > 0 && (
        <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
          {o.negativePlayers.map((p) => (
            <div key={p.playerId} style={{ fontSize: 12.5 }}>
              <strong>{p.name}</strong> — {posLabel(p.position)} — OVR {p.overall}
              <br />
              <span style={{ color: "var(--ink-faint)" }}>
                Unavailable: {o.absenceWeeks == null ? "rest of season" : `${o.absenceWeeks} week${o.absenceWeeks === 1 ? "" : "s"}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {o.coachFired && (
        <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-faint)" }}>
          {(() => {
            const next = Object.values(coaches).find((c) => c.team === e.teamCode && c.role === "HC");
            return next ? `${next.name} takes over as head coach.` : "The team is looking for a new head coach.";
          })()}
        </p>
      )}
      {o.wholeRosterOut && (
        <p style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-faint)" }}>
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
    <Card maxWidth={760}>
      <CardHeader badge="NEWS" title="League Developments" subtitle={`${s.season} preseason wrap-up`} />
      <div className="panel open" style={{ display: "grid", gap: 12 }}>
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
        <div className="panel open" style={{ display: "grid", gap: 6, marginTop: 12 }}>
          <p className="sectionlabel" style={{ margin: 0 }}>
            Hall of Fame class of {s.season - 1}
          </p>
          {(s.hallOfFame ?? [])
            .filter((h) => h.inducted === s.season - 1)
            .map((h) => (
              <div key={h.playerId} style={{ fontSize: 12.5 }}>
                <strong>{h.name}</strong>{" "}
                <span style={{ color: "var(--ink-dim)" }}>
                  {posLabel(h.position)} · {h.seasons} seasons · {h.why}
                </span>
              </div>
            ))}
        </div>
      )}
      <ReadinessGate
        title="League developments readiness"
        label="Continue to the Regular Season"
        onAdvance={(r) => nav(r)}
      />
    </Card>
  );
}

const ROLE_LABEL: Record<string, string> = { HC: "head coach", OC: "offensive coordinator", DC: "defensive coordinator" };

/** The offseason's CPU staff moves — who was let go, and who replaced him. */
function CoachingCarousel({ changes }: { changes: CoachingChange[] }) {
  if (changes.length === 0) return null;
  return (
    <div className="panel open" style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <p className="sectionlabel" style={{ margin: 0 }}>
        Coaching carousel
      </p>
      {changes.map((c, i) => (
        <div key={`${c.team}-${c.role}-${i}`} style={{ fontSize: 12.5 }}>
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
    </div>
  );
}
