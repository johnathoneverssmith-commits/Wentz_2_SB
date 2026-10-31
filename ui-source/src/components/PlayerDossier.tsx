import { useMemo } from "react";
import { TEAMS_BY_CODE } from "@/data/teams";
import type { Player } from "@/domain";
import { buildDossier, signed } from "@/state/dossier";
import { useStore } from "@/state/store";
import { PortraitSlot } from "@/visual/PortraitSlot";
import { millions, posLabel } from "@/util/format";
import { useDialog } from "./useDialog.ts";
import "./player-dossier.css";

/**
 * Scouting dossier: identity, contract where relevant, and a numeric table of
 * every skill the player model holds for him against the league's positional
 * average. Numbers only — no bars — and nothing the model doesn't have.
 */
export function PlayerDossier({ player, onClose }: { player: Player; onClose: () => void }) {
  const players = useStore((s) => s.players);
  const ref = useDialog(onClose);
  const d = useMemo(() => buildDossier(player, players), [player, players]);
  const team = TEAMS_BY_CODE[player.nfl_team];
  const status = player.retired ? "Retired" : player.free_agent ? "Available (undrafted / free agent)" : team ? `${team.city} ${team.name}` : player.nfl_team;
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div ref={ref} className="modal-card dossier" role="dialog" aria-modal="true" aria-labelledby="dossier-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head dossier-head">
          <PortraitSlot player={player} size={96} />
          <div className="dossier-id">
            <h2 id="dossier-title">{player.name}</h2>
            <p>{posLabel(player.position)} · Age {player.age} · {status}</p>
            <dl className="dossier-facts">
              <div><dt>OVR</dt><dd>{player.overall}</dd></div>
              <div><dt>vs position avg</dt><dd>{signed(d.overall.diff)}</dd></div>
              <div><dt>Experience</dt><dd>{player.years_pro === 0 ? "Rookie" : `${player.years_pro} yr`}</dd></div>
              {player.college && <div><dt>College</dt><dd>{player.college}</dd></div>}
              {player.archetype && <div><dt>Type</dt><dd>{player.archetype.replace(/_/g, " ")}</dd></div>}
              {d.draft && <div><dt>Drafted</dt><dd>{d.draft}</dd></div>}
            </dl>
          </div>
          <button type="button" className="dossier-close" onClick={onClose} aria-label="Close scouting dossier">Close</button>
        </div>
        <div className="modal-body">
          {d.contract && (
            <p className="dossier-contract">
              Contract: {d.contract.years_remaining} yr · {millions(d.contract.total_value)} total · {millions(d.contract.guaranteed)} guaranteed · {millions(d.contract.capHit)} cap hit this year
            </p>
          )}
          {d.skills.length === 0 ? (
            <p className="decision-muted">No skill ratings are recorded for this player.</p>
          ) : (
            <table className="dossier-table">
              <caption>
                Skills vs. league {posLabel(player.position)} average ({d.sample} players)
              </caption>
              <thead>
                <tr><th scope="col">Skill</th><th scope="col" className="n">Rating</th><th scope="col" className="n">League avg</th><th scope="col" className="n">+/−</th></tr>
              </thead>
              <tbody>
                {d.skills.map((s) => (
                  <tr key={s.key}>
                    <th scope="row">{s.label}</th>
                    <td className="n">{s.value}</td>
                    <td className="n">{s.average === null ? "—" : s.average.toFixed(1)}</td>
                    <td className={`n ${s.diff === null ? "" : s.diff > 0 ? "up" : s.diff < 0 ? "down" : ""}`}>{signed(s.diff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="dossier-note">Averages are computed live from every active {posLabel(player.position)} in the league. Ratings shown are current public ratings.</p>
        </div>
      </div>
    </div>
  );
}
