import { afterEach, expect, it, vi } from 'vitest';
const session = vi.hoisted(() => ({ value: null as any }));
vi.mock('./online.ts', () => ({ onlineSession: () => session.value }));
import { requestPlanPreview } from './planPreviewClient';
import { cleanPlan } from './gamePlan';
afterEach(() => { session.value = null; });
it('requires the engine response to identify the currently viewed online snapshot', async () => {
    const preview = { snapshot: 'v1', opponent: 'BUF', game: 'Preseason Week 1' };
    const call = vi.fn(async () => ({ preview }));
    session.value = { leagueId: 'test', version: 'v1', client: { previewPlan: call } };
    expect(await requestPlanPreview(cleanPlan({}))).toEqual(preview);
    expect(call).toHaveBeenCalledWith('test', cleanPlan({}));
    for (const snapshot of [undefined, 'v2']) {
        call.mockResolvedValueOnce({ preview: { ...preview, snapshot } as any });
        await expect(requestPlanPreview(cleanPlan({}))).rejects.toThrow('league changed');
    }
});
