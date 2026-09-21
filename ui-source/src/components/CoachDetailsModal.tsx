import { COACH_POSITION_GROUPS, COACH_ROLE_LABEL, SCHEME_LABEL, type Coach, type DevelopmentRole } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { ratingOf } from "@/state/coachingDraft";
import { useDialog } from "./useDialog.ts";

/**
 * Full read-out for one coach: whichever rated characteristics his job
 * actually carries. A head coach and a linebackers coach are rated on
 * different axes entirely (`ratingOf` already has to pick one number for the
 * board; this shows all of them), so the fields shown depend on `role`.
 */
export function CoachDetailsModal({ coach, onClose }: { coach: Coach; onClose: () => void }) {
  const dialogRef = useDialog(onClose);
  const group = COACH_POSITION_GROUPS[coach.role as DevelopmentRole];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-card-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="modal-title" id="coach-card-title">
              {coach.name}
            </p>
            <p className="modal-sub">
              {COACH_ROLE_LABEL[coach.role]}
              {coach.team ? ` · ${TEAMS_BY_CODE[coach.team]?.label ?? coach.team}` : " · Available"}
            </p>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="subhead" style={{ marginTop: 0 }}>
            Rating
          </p>
          <div className="split-3" style={{ gap: "6px 12px", marginBottom: 14 }}>
            <Stat label="Overall" value={ratingOf(coach)} />
            {coach.role === "HC" && (
              <>
                <Stat label="Discipline" value={coach.discipline} />
                <Stat label="Game management" value={coach.gameManagement} />
                <Stat label="Aggressiveness" value={coach.aggressiveness} />
              </>
            )}
            {(coach.role === "OC" || coach.role === "DC") && (
              <>
                <Stat label="Play-call IQ" value={coach.playCallIq} />
                {coach.role === "OC" && <Stat label="Pass rate" value={coach.tendencyPassRate} suffix="%" />}
                {coach.role === "DC" && <Stat label="Blitz rate" value={coach.tendencyBlitzRate} suffix="%" />}
              </>
            )}
          </div>

          {coach.scheme && (
            <>
              <p className="subhead">Scheme</p>
              <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--ink-dim)" }}>
                {SCHEME_LABEL[coach.scheme]}
              </p>
            </>
          )}

          {group && group.length > 0 && (
            <>
              <p className="subhead">Develops</p>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-dim)" }}>{group.join(", ")}</p>
            </>
          )}
          {coach.role === "MED" && (
            <>
              <p className="subhead">Develops</p>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-dim)" }}>
                Injury recovery for the whole roster
              </p>
            </>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, suffix = "" }: { label: string; value: number | undefined; suffix?: string }) {
  if (value == null) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
      <span style={{ color: "var(--ink-dim)" }}>{label}</span>
      <span className="oswald" style={{ fontWeight: 600 }}>
        {value}
        {suffix}
      </span>
    </div>
  );
}
