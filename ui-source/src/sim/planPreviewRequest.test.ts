import { it, expect, vi, afterEach } from 'vitest';
import { HttpSimulationService } from './HttpSimulationService';
import { cleanPlan } from '@/state/gamePlan';
afterEach(() => vi.unstubAllGlobals());
it('sends preview plans, actual roster/depth/staff/talent inputs and a bounded read-only request', async () => {
    let seen: any;
    let signal: unknown;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => { expect(url).toBe('http://localhost:8787/plan-preview'); seen = JSON.parse(init.body); signal = init.signal; return { ok: true, json: async () => ({ standard: 50, withPlan: 51 }) }; }));
    const plan = cleanPlan({ passRate: 12, blitz: 40 });
    const saved = cleanPlan({ qbRun: 30 });
    const players = [{ id: 'qb', nfl_team: 'LAR', position: 'QB', overall: 80 }] as never;
    await new HttpSimulationService().previewPlan({ seed: 5, phase: 'PRE', week: 1, homeTeam: 'LAR', awayTeam: 'BUF', side: 'home', plan, rosters: { LAR: players, BUF: players }, depthCharts: { LAR: { QB: ['qb'] } }, talentScale: 1.5, offenseAdjust: 2, staffs: {}, plans: { LAR: saved, BUF: cleanPlan({ blitz: 20 }) } });
    expect(seen).toMatchObject({ homeTeam: 'LA', awayTeam: 'BUF', side: 'home', plan, homePlan: saved, talentScale: 1.5, offenseAdjust: 2, homeDepth: { QB: ['qb'] }, homePlayers: [{ id: 'qb', nfl_team: 'LA' }] });
    expect(signal).toBeInstanceOf(AbortSignal);
});
