import { TEAMS_BY_CODE } from '@/data/teams';
import type { GamePlan } from '@/state/gamePlan';
import { usePlanComparison } from './usePlanComparison';
export function PlanProjection({ enabled, context, saved, plan }: {
    enabled: boolean;
    context: object;
    saved: GamePlan;
    plan: GamePlan;
}) {
    const p = usePlanComparison(enabled, context, saved, plan);
    if (!enabled)
        return null;
    return <aside className="game-plan-projection" aria-label="Preseason win projection" aria-busy={p.busy}>
  <h3>Preseason matchup lab</h3>
  {p.busy && <p role="status">Measuring this plan with the engine…</p>}
  {p.error && <><p role="status">Engine preview unavailable. {p.error}</p><p>The standalone offline simulator has no game-plan projection. A reachable engine adapter is required for solo previews; online leagues use their league server.</p><button type="button" onClick={p.retry}>Retry projection</button></>}
  {!p.busy && !p.error && p.value === null && <p>No scheduled opponent is available to preview.</p>}
  {p.value && <>
   <p>vs {TEAMS_BY_CODE[p.value.draft.opponent]?.label ?? p.value.draft.opponent} · {p.value.draft.game}</p>
   <div className="game-plan-probability"><strong data-testid="draft-win-probability">{p.value.draft.withPlan}%</strong><span>estimated win chance</span></div>
   <p className="game-plan-difference">{p.value.difference > 0 ? '+' : ''}{p.value.difference} percentage points vs saved plan ({p.value.saved.withPlan}%).</p>
   <p>{p.value.draft.games} seeded games per plan, against the actual available rosters, lineup, coaches, weather and opponent plan.</p>
   <p>Sample uncertainty in margin: saved ±{p.value.saved.plusMinus}, preview ±{p.value.draft.plusMinus} points. {p.value.draft.tooClose || p.value.saved.tooClose ? 'Small differences may be simulation noise. ' : ''}Rounded estimates can stay unchanged. This is an experiment, not a predicted result.</p>
  </>}
 </aside>;
}
