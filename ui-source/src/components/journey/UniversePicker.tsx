import { useId, useRef, useState } from "react";
import type { LeagueConfig } from "@/domain";
import { ERAS } from "@/sim/leagueDna";
import { useStore } from "@/state/store";
import { useSetupCreating } from "./SetupCreationNotice";
import { parseSetupSeed } from "./SetupSeed";
import { DecisionError } from "@/components/decisions/DecisionWorkspace";
import { DEFAULT_ERA_ID, describeUniverse, randomSeed, UNIVERSE_HINT, UNIVERSE_LABEL, universeOf, universePatch, type UniverseKind } from "@/state/universe";
import "@/visual/visual.css";

const KINDS: UniverseKind[] = ["legacy", "fictional", "era"];

/**
 * League universe and seed. The universe is fixed when a league is created,
 * so choosing one creates a fresh solo setup (team picks are cleared, league
 * rules are kept) — exactly what the older "restart with seed" did.
 */
export function UniversePicker({ seed, config, canRestart }: { seed: number | null | undefined; config: LeagueConfig; canRestart: boolean }) {
  const id = useId();
  const current = universeOf(config);
  const [kind, setKind] = useState<UniverseKind>(current.kind);
  const [eraId, setEraId] = useState<string>(current.eraId ?? DEFAULT_ERA_ID);
  const [seedText, setSeedText] = useState(String(seed ?? ""));
  const [error, setError] = useState<string | null>(null);
  const busy = useSetupCreating();
  const acting = useRef(false);
  const create = useStore((s) => s.newLeague);
  const dna = useStore((s) => s.dna);
  const parsed = parseSetupSeed(seedText);
  const era = ERAS.find((e) => e.id === eraId);
  const changed = kind !== current.kind || (kind === "era" && eraId !== current.eraId) || parsed !== seed;

  return (
    <section className="universe-picker" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} style={{ margin: 0 }}>League universe</h3>
      <p style={{ margin: 0 }}>
        Current: <strong>{describeUniverse({ config, dna })}</strong>, seed <output>{seed ?? "generated"}</output>.
        {dna?.profile && <> {dna.profile.title}: {dna.profile.blurb}</>}
      </p>
      {canRestart ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (parsed === undefined || busy || acting.current) return;
            if (!window.confirm("Create a new solo setup with this universe? Team selections and the current setup will be replaced; your league rules are kept.")) return;
            acting.current = true;
            setError(null);
            try {
              await create(parsed, { ...config, ...universePatch({ kind, eraId }) });
            } catch (err) {
              setError(err instanceof Error ? err.message : "The new setup could not be created.");
            } finally {
              acting.current = false;
            }
          }}
        >
          <div role="radiogroup" aria-label="Universe" className="universe-opts">
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className="universe-opt" onClick={() => setKind(k)} disabled={busy}>
                <b>{UNIVERSE_LABEL[k]}</b>
                <span>{UNIVERSE_HINT[k]}</span>
              </button>
            ))}
          </div>
          <div className="universe-row" style={{ marginTop: 12 }}>
            {kind === "era" && (
              <label>
                Historical era
                <select value={eraId} onChange={(e) => setEraId(e.target.value)} disabled={busy}>
                  {ERAS.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
                </select>
              </label>
            )}
            <label>
              Seed
              <input inputMode="numeric" pattern="[0-9]+" value={seedText} aria-describedby={`${id}-seedhint`} onChange={(e) => setSeedText(e.target.value)} disabled={busy} aria-invalid={parsed === undefined} />
            </label>
            <button type="button" className="btnlink" onClick={() => setSeedText(String(randomSeed()))} disabled={busy}>Random seed</button>
            <button type="submit" className="btnlink" disabled={busy || parsed === undefined || !changed}>{busy ? "Creating setup…" : "Create league with this universe"}</button>
          </div>
          <p id={`${id}-seedhint`} style={{ fontSize: 12, margin: "6px 0 0" }}>
            Whole number 0 to 4294967295; the same seed, universe and era always make the same league.
            {kind === "era" && era && <> {era.title}: {era.gist}. {era.note} This leans position-group strength toward that emphasis; it does not reproduce real players or ratings, and later draft classes are generated on their own.</>}
          </p>
          <DecisionError message={error} />
        </form>
      ) : (
        <p>The universe and seed are fixed once a league is online, disconnected from a solo save, or running.</p>
      )}
    </section>
  );
}
