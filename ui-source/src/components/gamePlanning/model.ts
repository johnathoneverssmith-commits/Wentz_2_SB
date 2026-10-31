import type { LeagueState } from '@/domain';
import type { GamePlan } from '@/state/gamePlan';
import type { PlanPreviewAnswer } from '@/state/planPreview';
export function canManagePlan(s: Pick<LeagueState, 'viewerGmId' | 'gms' | 'teams'>, detached: boolean): boolean {
    const gm = s.gms.find(g => g.id === s.viewerGmId);
    const owner = gm?.teamCode ? s.teams[gm.teamCode]?.controlledBy : null;
    return !detached && !!gm?.teamCode && owner?.kind === 'human' && owner.gmId === gm.id;
}
export interface PlanComparison {
    saved: PlanPreviewAnswer;
    draft: PlanPreviewAnswer;
    difference: number;
}
function validate(a: PlanPreviewAnswer): void {
    if (!a.opponent || !a.game || !Number.isInteger(a.games) || a.games <= 0 || ![a.standard, a.withPlan].every(n => Number.isInteger(n) && n >= 0 && n <= 100) || ![a.marginDelta, a.plusMinus].every(Number.isFinite) || a.plusMinus < 0 || typeof a.tooClose !== 'boolean')
        throw Error('The engine returned an invalid projection. Try again.');
}
/** Both estimates use the existing seeded engine lab. No UI probability modifiers. */
export async function comparePlans(saved: GamePlan, draft: GamePlan, request: (p: GamePlan) => Promise<PlanPreviewAnswer | null>): Promise<PlanComparison | null> {
    const a = await request({ ...saved });
    if (!a)
        return null;
    validate(a);
    const b = JSON.stringify(saved) === JSON.stringify(draft) ? a : await request({ ...draft });
    if (!b)
        return null;
    validate(b);
    if (a.opponent !== b.opponent || a.game !== b.game || a.games !== b.games || a.standard !== b.standard || a.snapshot !== b.snapshot)
        throw Error('The matchup changed during the projection. Try again.');
    return { saved: a, draft: b, difference: b.withPlan - a.withPlan };
}
