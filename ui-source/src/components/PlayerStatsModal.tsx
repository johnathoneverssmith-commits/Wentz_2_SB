import { TEAMS_BY_CODE } from "@/data/teams";
import { passerRating } from "@/state/leagueStats";
import type { Player } from "@/domain";
import { millions, posLabel } from "@/util/format";
import { useDialog } from "./useDialog.ts";
import { useStore } from "@/state/store";

/**
 * Full read-out for one player: identity, contract, this season's counting
 * stats, and the 0–99 attributes. The sim predicts outcomes from these
 * individual numbers, not from `overall`.
 */
const NONE: never[] = [];

export function PlayerStatsModal({ player, onClose }: { player: Player; onClose: () => void }) {
  const st = player.season_stats;
  // stable fallbacks: a fresh `[]` per render would re-render forever
  const awards = (useStore((s) => s.awards) ?? NONE).filter((a) => a.playerId === player.id);
  const allPros = (useStore((s) => s.allPro) ?? NONE).filter((a) => a.playerId === player.id).length;
  const hof = (useStore((s) => s.hallOfFame) ?? NONE).some((h) => h.playerId === player.id);
  // strongest first, so the card says what the player is good at
  const attrs = Object.entries(player.attributes)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => (b[1] as number) - (a[1] as number));
  // the stats are the season just played until the next one starts, and
  // "This season" in the offseason meant last season
  // Season stats reset when the regular season starts, so through the
  // preseason (after the new year has begun) they're still last year's —
  // a backup read "2030 season: 164/249" off one preseason game
  const season = useStore((s) =>
    s.stage === "preseason" || s.stage === "leagueDevelopments" ? s.season - 1 : s.season,
  );
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
              {player.name} · {posLabel(player.position)}
            </p>
            <p className="modal-sub">
              {TEAMS_BY_CODE[player.nfl_team]?.label ?? "Free agent"} · age {player.age} · {player.overall} OVR
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
              ? `${millions(player.contract.cap_hit_by_year[0] ?? 0)} this year · ${player.contract.years_remaining} yr${player.contract.years_remaining === 1 ? "" : "s"} left · ${millions(player.contract.total_value)} total · ${millions(player.contract.guaranteed)} gtd`
              : player.free_agent
                ? "Free agent"
                : "—"}
          </p>

          {(awards.length > 0 || allPros > 0 || hof) && (
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--accent, var(--good))" }}>
              {[
                hof ? "Hall of Fame" : null,
                ...awards.map((a) => `${a.season} ${a.award}`),
                allPros > 0 ? `${allPros}x All-Pro` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}

          <p className="subhead">{season} season</p>
          {st && st.gamesPlayed > 0 ? (
            <table className="stbl" style={{ marginBottom: 14 }}>
              <tbody>
                {statLine("Games", st.gamesPlayed)}
                {maybe("Passing", st.passYds != null && st.passYds > 0, `${st.passCmp ?? 0}/${st.passAtt ?? 0}, ${st.passYds} yds, ${st.passTd ?? 0} TD, ${st.passInt ?? 0} INT${passerRating(st) !== null ? `, ${passerRating(st)!.toFixed(1)} rating` : ""}`)}
                {maybe("Rushing", (st.rushYds ?? 0) !== 0, `${st.rushAtt ?? 0} att, ${st.rushYds ?? 0} yds, ${st.rushTd ?? 0} TD`)}
                {maybe("Receiving", (st.recYds ?? 0) > 0, `${st.rec ?? 0} rec, ${st.recYds} yds, ${st.recTd ?? 0} TD`)}
                {maybe("Defense", (st.tackles ?? 0) > 0 || (st.sacks ?? 0) > 0, `${st.tackles ?? 0} tkl, ${st.sacks ?? 0} sk, ${st.defInt ?? 0} INT, ${st.ffum ?? 0} FF, ${st.passDef ?? 0} PD`)}
                {maybe("Kicking", (st.fga ?? 0) > 0, `${st.fgm ?? 0}/${st.fga ?? 0} FG, ${st.xpm ?? 0}/${st.xpa ?? 0} XP`)}
              </tbody>
            </table>
          ) : (
            <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--ink-faint)" }}>No games logged yet this season.</p>
          )}

          {player.career && player.career.seasons > 0 && (
            <>
              <p className="subhead">Career · {player.career.seasons} season{player.career.seasons === 1 ? "" : "s"} in the league</p>
              <table className="stbl" style={{ marginBottom: 14 }}>
                <tbody>
                  {statLine("Games", player.career.gamesPlayed)}
                  {maybe("Passing", (player.career.passYds ?? 0) > 0, `${player.career.passYds} yds, ${player.career.passTd ?? 0} TD, ${player.career.passInt ?? 0} INT`)}
                  {maybe("Rushing", (player.career.rushYds ?? 0) > 0, `${player.career.rushAtt ?? 0} att, ${player.career.rushYds} yds, ${player.career.rushTd ?? 0} TD`)}
                  {maybe("Receiving", (player.career.recYds ?? 0) > 0, `${player.career.rec ?? 0} rec, ${player.career.recYds} yds, ${player.career.recTd ?? 0} TD`)}
                  {maybe("Defense", (player.career.tackles ?? 0) > 0 || (player.career.sacks ?? 0) > 0, `${player.career.tackles ?? 0} tkl, ${player.career.sacks ?? 0} sk, ${player.career.defInt ?? 0} INT`)}
                  {maybe("Kicking", (player.career.fga ?? 0) > 0, `${player.career.fgm ?? 0}/${player.career.fga ?? 0} FG`)}
                </tbody>
              </table>
            </>
          )}

          <p className="subhead">Attributes</p>
          <div className="split-3" style={{ gap: "6px 12px" }}>
            {attrs.map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                <span style={{ color: "var(--ink-dim)" }}>
                  {k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
                </span>
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
