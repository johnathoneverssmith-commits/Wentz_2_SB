import { TEAMS_BY_CODE } from "@/data/teams";
import type { Player } from "@/domain";
import { millions } from "@/util/format";
import { useDialog } from "./useDialog.ts";

/**
 * Full read-out for one player: identity, contract, this season's counting
 * stats, and the 0–99 attributes. The sim predicts outcomes from these
 * individual numbers, not from `overall`.
 */
export function PlayerStatsModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const st = player.season_stats;
  const attrs = Object.entries(player.attributes).filter(([, v]) => typeof v === "number");
  const dialogRef = useDialog(onClose);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal-card"
        style={{ maxWidth: 520 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-card-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="modal-title" id="player-card-title">
              {player.name} · {player.position}
            </p>
            <p className="modal-sub">
              {TEAMS_BY_CODE[player.nfl_team]?.city ?? "Free agent"} · age {player.age} · {player.overall} OVR
            </p>
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-body" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <p className="subhead" style={{ marginTop: 0 }}>
            Contract
          </p>
          <p style={{ margin: "0 0 14px", fontSize: 12.5, color: "var(--ink-dim)" }}>
            {player.contract
              ? `${player.contract.years_remaining} yrs · ${millions(player.contract.total_value)} total · ${millions(player.contract.guaranteed)} gtd`
              : player.free_agent
                ? "Free agent"
                : "—"}
          </p>

          <p className="subhead">This season</p>
          {st && st.gamesPlayed > 0 ? (
            <table className="stbl" style={{ marginBottom: 14 }}>
              <tbody>
                {statLine("Games", st.gamesPlayed)}
                {maybe("Passing", st.passYds != null && st.passYds > 0, `${st.passCmp ?? 0}/${st.passAtt ?? 0}, ${st.passYds} yds, ${st.passTd ?? 0} TD, ${st.passInt ?? 0} INT`)}
                {maybe("Rushing", (st.rushYds ?? 0) !== 0, `${st.rushAtt ?? 0} att, ${st.rushYds ?? 0} yds, ${st.rushTd ?? 0} TD`)}
                {maybe("Receiving", (st.recYds ?? 0) > 0, `${st.rec ?? 0} rec, ${st.recYds} yds, ${st.recTd ?? 0} TD`)}
                {maybe("Defense", (st.tackles ?? 0) > 0 || (st.sacks ?? 0) > 0, `${st.tackles ?? 0} tkl, ${st.sacks ?? 0} sk, ${st.defInt ?? 0} INT, ${st.passDef ?? 0} PD`)}
                {maybe("Kicking", (st.fga ?? 0) > 0, `${st.fgm ?? 0}/${st.fga ?? 0} FG, ${st.xpm ?? 0}/${st.xpa ?? 0} XP`)}
              </tbody>
            </table>
          ) : (
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--ink-faint)" }}>No games logged yet this season.</p>
          )}

          <p className="subhead">Attributes</p>
          <div className="split-3" style={{ gap: "6px 12px" }}>
            {attrs.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                <span style={{ color: "var(--ink-dim)" }}>{k.replace(/_/g, " ")}</span>
                <span className="oswald" style={{ fontWeight: 600 }}>
                  {v as number}
                </span>
              </div>
            ))}
          </div>
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

function statLine(label: string, value: number | string) {
  return (
    <tr>
      <td>{label}</td>
      <td className="r">{value}</td>
    </tr>
  );
}
function maybe(label: string, show: boolean, value: string) {
  return show ? statLine(label, value) : null;
}
