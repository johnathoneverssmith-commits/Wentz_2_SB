import { test, expect, SAVE_KEY } from '../support/test.ts';
import { controlledLeague } from '../support/controlled-league.ts';
import type { Page, Locator } from '@playwright/test';
async function capture(page: Page, panel: Locator, width: number) {
    await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    // Capture document coordinates without scrolling the card beneath sticky navigation.
    await page.screenshot({path: `${process.env.GAMEPLAN_ARTIFACTS}/command-center-${width}.png`, fullPage: true, clip: box!});
}
const saved = (page: any) => page.evaluate((k: string) => JSON.parse(localStorage.getItem(k)!).state, SAVE_KEY);
for (const width of [1440, 390])
    test.describe(`command-center game planning ${width}`, () => {
        test.use({ fixtureName: 'preseason' });
        test('previews unsaved strategies automatically and saves both through reload', async ({ page }) => {
            await page.setViewportSize({ width, height: 1000 });
            const requests: any[] = [];
            await page.route('http://localhost:8787/plan-preview', async (route) => {
                const body = route.request().postDataJSON();
                requests.push(body);
                await route.fulfill({ json: { standard: 50, withPlan: 50 + Math.round(body.plan.passRate / 3) - Math.round(body.plan.blitz / 25), marginDelta: 1, plusMinus: 2, tooClose: true, games: 160 } });
            });
            await page.goto('/#/hub');
            const before = await saved(page);
            const gm = before.gms.find((g: any) => g.id === before.viewerGmId);
            const panel = page.getByRole('region', { name: 'Command center game plan' });
            await expect(panel).toBeVisible();
            await expect(panel.getByText('50%', { exact: true }).first()).toBeVisible();
            await panel.getByRole('slider', { name: 'Offensive pass bias' }).fill('12');
            await panel.getByRole('slider', { name: 'Offensive pass bias' }).focus();
            await page.keyboard.press('ArrowLeft');
            await expect(panel.getByRole('slider', { name: 'Offensive pass bias' })).toHaveValue('11');
            await page.keyboard.press('ArrowRight');
            await panel.getByRole('slider', { name: 'Defensive blitz bias' }).fill('50');
            await expect(panel.getByTestId('draft-win-probability')).toHaveText('52%');
            expect((await saved(page)).gamePlans).toEqual(before.gamePlans);
            expect(requests.at(-1).plan.passRate).toBe(12);
            expect(requests.at(-1).plan.blitz).toBe(50);
            await panel.getByRole('button', { name: 'Save game plan', exact: true }).click();
            await expect(panel.getByRole('status').filter({ hasText: 'Game plan saved.' })).toBeVisible();
            const after = await saved(page);
            expect(after.gamePlans[gm.teamCode]).toMatchObject({ passRate: 12, blitz: 50 });
            await page.reload();
            await expect(panel.getByRole('slider', { name: 'Offensive pass bias' })).toHaveValue('12');
            await expect(panel.getByRole('slider', { name: 'Defensive blitz bias' })).toHaveValue('50');
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            if (process.env.GAMEPLAN_ARTIFACTS)
                await capture(page, panel, width);
        });
    });
test.describe('command-center truthful preview', () => {
    test.use({ fixtureName: 'preseason' });
    test('reports an unavailable engine without inventing a probability', async ({ page }) => {
        await page.route('http://localhost:8787/plan-preview', r => r.fulfill({ status: 503, json: { error: 'Unavailable' } }));
        await page.goto('/#/hub');
        const panel = page.getByRole('region', { name: 'Command center game plan' });
        await expect(panel.getByText(/Engine preview unavailable/)).toBeVisible();
        await expect(panel.getByTestId('draft-win-probability')).toHaveCount(0);
    });
    test('server refusal never reports successful saving', async ({ page, origin }) => {
        await page.goto('/');
        const state = await saved(page);
        const gm = state.gms.find((g: any) => g.id === state.viewerGmId);
        const server = await controlledLeague(page, origin, state, { teamCode: gm.teamCode, gmId: gm.id }, async () => ({ status: 403, body: { error: 'Game plan refused.' } }));
        await page.reload();
        await page.goto('/#/hub');
        const panel = page.getByRole('region', { name: 'Command center game plan' });
        await panel.getByRole('slider', { name: 'Offensive pass bias' }).fill('12');
        await panel.getByRole('button', { name: 'Save game plan', exact: true }).click();
        await expect(panel.getByText('Game plan refused.', { exact: true })).toBeVisible();
        expect(server.requests.filter(r => r.path.endsWith('/actions/gameplan'))).toHaveLength(1);
        expect(server.unexpected).toEqual([]);
    });
});
test.describe('command-center preview isolation', () => {
    test.use({ fixtureName: 'preseason' });
    test('ignores obsolete results and serializes the latest unsaved plan', async ({ page }) => {
        let release: () => void = () => { };
        const held = new Promise<void>(r => { release = r; });
        let count = 0;
        let active = 0;
        let maxActive = 0;
        await page.route('http://localhost:8787/plan-preview', async (r) => {
            const b = r.request().postDataJSON();
            count++;
            active++;
            maxActive = Math.max(maxActive, active);
            if (count === 1)
                await held;
            await r.fulfill({ json: { standard: 50, withPlan: 50 + Math.round(b.plan.passRate / 3), marginDelta: 1, plusMinus: 2, tooClose: true, games: 160 } });
            active--;
        });
        await page.goto('/#/hub');
        const panel = page.getByRole('region', { name: 'Command center game plan' });
        await expect.poll(() => count).toBe(1);
        await panel.getByRole('slider', { name: 'Offensive pass bias' }).fill('12');
        await expect(panel.getByTestId('draft-win-probability')).toHaveCount(0);
        release();
        await expect(panel.getByTestId('draft-win-probability')).toHaveText('54%');
        expect(maxActive).toBe(1);
        expect(count).toBe(3);
    });
    test('does not fetch a preview for a missing persisted schedule', async ({ page }) => {
        let count = 0;
        await page.route('http://localhost:8787/plan-preview', async (r) => { count++; await r.abort(); });
        await page.goto('/');
        await page.evaluate(k => { const doc = JSON.parse(localStorage.getItem(k)!); doc.state.schedule = []; localStorage.setItem(k, JSON.stringify(doc)); }, SAVE_KEY);
        await page.reload();
        await page.goto('/#/hub');
        const panel = page.getByRole('region', { name: 'Command center game plan' });
        await expect(panel.getByText('No valid scheduled opponent is available to preview.')).toBeVisible();
        expect(count).toBe(0);
    });
});
// This path executes the real engine in the isolated Node test process. The browser still
// receives only the adapter-shaped answer; no hosted service or database is contacted.
test.describe('command-center engine evidence', () => {
    test.use({ fixtureName: 'preseason' });
    test('displays real seeded-engine estimates and preserves advanced settings', async ({ page }) => {
        test.setTimeout(240000);
        const { previewPlan } = await import('../../src/engine/plan-preview.ts');
        const { Roster } = await import('../../src/engine/roster.ts');
        const { weatherFor } = await import('../../src/engine/weather.ts');
        const estimates: any[] = [];
        await page.route('http://localhost:8787/plan-preview', async (route) => {
            const b = route.request().postDataJSON();
            let seed = 2166136261;
            for (const c of `${b.seed}|${b.phase}|${b.week}|${b.homeTeam}|${b.awayTeam}|preview`) {
                seed ^= c.charCodeAt(0);
                seed = Math.imul(seed, 16777619);
            }
            seed >>>= 0;
            expect(b.homePlayers.length).toBeGreaterThan(0);
            expect(b.awayPlayers.length).toBeGreaterThan(0);
            const options = { homeRoster: new Roster(b.homeTeam, b.homePlayers, b.homeDepth), awayRoster: new Roster(b.awayTeam, b.awayPlayers, b.awayDepth), talentScale: b.talentScale, offenseAdjust: b.offenseAdjust, overtime: 'nfl' as const, weather: weatherFor(b.homeTeam, b.phase, b.week, seed), homePlan: b.homePlan, awayPlan: b.awayPlan, homeStaff: b.homeStaff, awayStaff: b.awayStaff };
            const answer = previewPlan(seed, b.homeTeam, b.awayTeam, options, b.side, b.plan);
            estimates.push({ plan: b.plan, answer });
            await route.fulfill({ json: answer });
        });
        await page.goto('/#/game-plan');
        await page.getByRole('slider', { name: 'Quarterback runs', exact: true }).fill('37');
        await page.getByRole('button', { name: 'Save plan', exact: true }).click();
        await expect(page.getByText('Saved. It applies to every game from the next one simulated.', { exact: true })).toBeVisible();
        await page.goto('/#/hub');
        const panel = page.getByRole('region', { name: 'Command center game plan' });
        await expect(panel.getByTestId('draft-win-probability')).toBeVisible({ timeout: 90000 });
        const base = estimates.at(-1).answer.withPlan;
        await panel.getByRole('slider', { name: 'Offensive pass bias' }).fill('12');
        await panel.getByRole('slider', { name: 'Defensive blitz bias' }).fill('50');
        await expect(panel.getByTestId('draft-win-probability')).toHaveCount(0);
        await expect.poll(() => estimates.some(e => e.plan.passRate === 12 && e.plan.blitz === 50), { timeout: 90000 }).toBe(true);
        const final = estimates.at(-1);
        expect(final.plan.qbRun).toBe(37);
        await expect(panel.getByTestId('draft-win-probability')).toHaveText(`${final.answer.withPlan}%`);
        await expect(panel).toContainText(`${final.answer.withPlan - base} percentage points vs saved plan (${base}%).`);
        const before = await saved(page);
        const gm = before.gms.find((g: any) => g.id === before.viewerGmId);
        expect(before.gamePlans[gm.teamCode]).toMatchObject({ qbRun: 37, passRate: 0, blitz: 0 });
        if (process.env.GAMEPLAN_ARTIFACTS)
            for (const width of [1440, 390]) {
                await page.setViewportSize({ width, height: 1000 });
                await capture(page, panel, width);
            }
        await panel.getByRole('button', { name: 'Save game plan', exact: true }).click();
        await expect(panel.getByRole('status').filter({ hasText: 'Game plan saved.' })).toBeVisible();
        expect((await saved(page)).gamePlans[gm.teamCode]).toMatchObject({ qbRun: 37, passRate: 12, blitz: 50 });
    });
});
test.describe('command-center online evidence', () => {
    test.use({ fixtureName: 'preseason' });
    test('rejects a newer server snapshot and labels precomputed blocks truthfully', async ({ page, origin }) => {
        await page.goto('/');
        const state = await saved(page);
        const gm = state.gms.find((g: any) => g.id === state.viewerGmId);
        await controlledLeague(page, origin, state, { teamCode: gm.teamCode, gmId: gm.id });
        await page.route('http://127.0.0.1:9/**/plan-preview', async (r) => { if (r.request().method() === 'OPTIONS') {
            await r.fallback();
            return;
        } await r.fulfill({ headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' }, json: { preview: { standard: 50, withPlan: 50, marginDelta: 0, plusMinus: 2, tooClose: true, games: 160, opponent: 'BUF', game: 'Preseason Week 1', snapshot: 'newer-version' } } }); });
        await page.reload();
        await page.goto('/#/hub');
        const panel = page.getByRole('region', { name: 'Command center game plan' });
        await expect(panel).toContainText('Online blocks already simulated cannot be changed.');
        await expect(panel.getByText(/The league changed/)).toBeVisible();
        await expect(panel.getByTestId('draft-win-probability')).toHaveCount(0);
    });
});
