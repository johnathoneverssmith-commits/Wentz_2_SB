import { expect, it } from 'vitest';
import { comparePlans, canManagePlan } from './model';
import { cleanPlan } from '@/state/gamePlan';
import type { PlanPreviewAnswer } from '@/state/planPreview';
const result = (withPlan: number): PlanPreviewAnswer => ({ standard: 50, withPlan, marginDelta: 1, plusMinus: 2, tooClose: true, games: 160, opponent: 'BUF', game: 'Preseason Week 1' });
it('compares the saved custom plan, not the standard plan, without mutating either', async () => {
    const saved = cleanPlan({ passRate: 8, qbRun: 37 });
    const draft = cleanPlan({ ...saved, blitz: 40 });
    const before = JSON.stringify([saved, draft]);
    const calls: unknown[] = [];
    const out = await comparePlans(saved, draft, async (p) => { calls.push(p); return result(p.blitz === 40 ? 54 : 57); });
    expect(out?.saved.withPlan).toBe(57);
    expect(out?.draft.withPlan).toBe(54);
    expect(out?.difference).toBe(-3);
    expect(calls).toEqual([saved, draft]);
    expect(JSON.stringify([saved, draft])).toBe(before);
});
it('reuses the same estimate for an unchanged plan and accepts equal rounded projections', async () => {
    let n = 0;
    const p = cleanPlan({ blitz: 20 });
    const out = await comparePlans(p, p, async () => { n++; return result(51); });
    expect(n).toBe(1);
    expect(out?.difference).toBe(0);
});
it('rejects mismatched or malformed evidence and missing games', async () => {
    const p = cleanPlan({});
    const q = cleanPlan({ blitz: 20 });
    expect(await comparePlans(p, q, async () => null)).toBeNull();
    for (const patch of [{ withPlan: NaN }, { withPlan: 101 }, { games: 0 }, { opponent: 'KC' }, { game: 'Week 2' }, { standard: 49 }]) {
        let n = 0;
        await expect(comparePlans(p, q, async () => n++ === 0 ? result(50) : ({ ...result(52), ...patch }))).rejects.toThrow();
    }
});
it('permits only the active human owner and never a detached online save', () => {
    const s = { viewerGmId: 'g', gms: [{ id: 'g', teamCode: 'KC' }], teams: { KC: { controlledBy: { kind: 'human', gmId: 'g' } } } } as never;
    expect(canManagePlan(s, false)).toBe(true);
    expect(canManagePlan(s, true)).toBe(false);
    expect(canManagePlan({ ...s as object, viewerGmId: 'other' } as never, false)).toBe(false);
    expect(canManagePlan({ ...s as object, teams: { KC: { controlledBy: { kind: 'ai' } } } } as never, false)).toBe(false);
});
it('rejects different server snapshots even when the rounded baseline and matchup match', async () => {
    let n = 0;
    await expect(comparePlans(cleanPlan({}), cleanPlan({ blitz: 20 }), async () => ({ ...result(50), snapshot: n++ === 0 ? 'v1' : 'v2' }))).rejects.toThrow('matchup changed');
});
