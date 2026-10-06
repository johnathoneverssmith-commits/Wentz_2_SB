import { useState } from "react";

import { Panel } from "@/components/primitives";
import { useStore } from "@/state/store";
import { isOnline, onlineSession } from "@/state/online";
import { useLeagueActions } from "@/state/useLeagueActions";

/**
 * How much of this offseason's draft and free agency the human GMs play, set
 * at the start of every offseason. Online it is the commissioner's call (the
 * league's setting, like every other); solo it is yours.
 */
export function OffseasonRounds() {
  const config = useStore((s) => s.config);
  const stage = useStore((s) => s.stage);
  const actions = useLeagueActions();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const online = isOnline();
  const commissioner = !online || !!onlineSession()?.isCommissioner;
  if (stage !== "endOfSeasonWin" && stage !== "endOfSeasonConsolation") return null;

  const draftValue = config.draftHumanRounds === undefined ? "1" : config.draftHumanRounds === null ? "all" : String(config.draftHumanRounds);
  const faValue = config.faHumanRounds == null ? "all" : String(config.faHumanRounds);
  const save = (patch: { draftHumanRounds?: number | null; faHumanRounds?: number | null }) => {
    setBusy(true);
    setError(null);
    void actions
      .setConfig(patch)
      .then((r) => {
        if (!r.ok) setError(r.reason ?? "Couldn't change that.");
      })
      .finally(() => setBusy(false));
  };
  return (
    <Panel id="offseason-rounds" open>
      <p className="subhead" style={{ marginTop: 24 }}>
        Offseason: how much you play by hand
      </p>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Rookie draft rounds
          <select
            value={draftValue}
            disabled={busy || !commissioner}
            onChange={(e) => save({ draftHumanRounds: e.target.value === "all" ? null : Number(e.target.value) })}
          >
            {["1", "2", "3", "all"].map((v) => (
              <option key={v} value={v}>
                {v === "all" ? "All 7" : v}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Free agency rounds
          <select
            value={faValue}
            disabled={busy || !commissioner}
            onChange={(e) => save({ faHumanRounds: e.target.value === "all" ? null : Number(e.target.value) })}
          >
            {["1", "2", "3", "4", "all"].map((v) => (
              <option key={v} value={v}>
                {v === "all" ? "All 5" : v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--ink-faint)" }}>
        {commissioner
          ? "After these rounds your staff makes the picks and the turns. You can change this again next offseason."
          : "The commissioner sets this for the league at the start of each offseason."}
      </p>
      {error && (
        <p className="form-error" role="status" style={{ margin: "6px 0 0" }}>
          {error}
        </p>
      )}
    </Panel>
  );
}
