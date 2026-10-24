import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
import { button, saved, startClocked } from './helpers';

test.setTimeout(420_000);

const KEYS = {
    home: { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', pass: 'KeyQ', hands: 'KeyR', kick: 'KeyG' },
    away: { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', pass: 'Comma', hands: 'ShiftRight', kick: 'Quote' },
} as const;
const MID = 26.67;
const other = (t: 'home' | 'away') => (t === 'home' ? 'away' : 'home');
const at = (s: DownState, id: string) => s.players.find(p => p.id === id)!;

/** Presses and releases movement keys so exactly the wanted ones are held. */
async function hold(page: Page, held: Set<string>, want: Set<string>) {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
/** Movement toward a point with a dead zone, for one team's keys. */
function toward(team: 'home' | 'away', from: { x: number; y: number }, to: { x: number; y: number }, dead = 0.6): Set<string> {
    const k = KEYS[team], want = new Set<string>();
    if (to.x - from.x > dead) want.add(k.right); else if (from.x - to.x > dead) want.add(k.left);
    if (to.y - from.y > dead) want.add(k.down); else if (from.y - to.y > dead) want.add(k.up);
    return want;
}

test('a complete game in a real browser: both players attack and defend through four quarters, kicks and a final', async ({ page }) => {
    await startClocked(page);
    const held = new Set<string>();
    const seen = { quarters: new Set<number>(), kicksXp: 0, kicksFg: 0, passes: 0, hands: 0, fgTried: 0, touchdowns: 0, turnovers: 0, firstDowns: 0, halftimeOffense: '', overtime: false, reloaded: false };
    let handsFlight = -1, throwPlay = -1, lastTerminal = 0, safety = 0;
    let s = await saved(page);
    for (let i = 0; i < 9000 && s.phase !== 'final'; i++) {
        seen.quarters.add(s.quarter);
        if (s.mode === 'overtime') seen.overtime = true;
        if (s.quarter === 3 && s.phase === 'pre-snap' && !seen.halftimeOffense) seen.halftimeOffense = `${s.offense}@${s.line}`;
        if (s.terminalCount !== lastTerminal) {
            lastTerminal = s.terminalCount;
            if (s.kick?.kind === 'xp' && s.kick.good !== null) seen.kicksXp++;
            if (s.kick?.kind === 'fg' && s.kick.good !== null) seen.kicksFg++;
        }
        if (s.phase === 'pre-snap') {
            await hold(page, held, new Set());
            const yardsToGoal = s.offense === 'home' ? 110 - s.line : s.line - 10;
            const toGo = Math.abs(s.firstDownLine - s.line);
            let choice: string;
            if (s.down === 4 && yardsToGoal <= 40 && (toGo > 3 || yardsToGoal < 35)) { choice = 'fieldgoal'; seen.fgTried++; }
            else choice = (['rush', 'slants', 'go', 'rush', 'slants'] as const)[s.playNumber % 5]!;
            if (s.play !== choice) await page.getByLabel('Play', { exact: true }).selectOption(choice);
            await button(page, choice === 'fieldgoal' ? 'Kick field goal' : 'Snap').click();
            handsFlight = -1;
            throwPlay = choice === 'slants' || choice === 'go' ? s.playNumber : -1;
        }
        else if (s.phase === 'live') {
            const off = s.offense, def = other(off), carrier = at(s, s.possession.carrier), defender = at(s, s.defender);
            // Offense: run toward the goal line, drifting to the middle; throw early on passing plays.
            const goalX = off === 'home' ? 112 : 8;
            const offWant = toward(off, carrier, { x: goalX, y: Math.abs(carrier.y - MID) > 5 ? MID : carrier.y }, 0.6);
            if (s.ball.kind === 'flight') {
                const defWant = toward(def, defender, s.ball.to, 0.4);
                if (s.ball.elapsed > 0.45 && handsFlight !== s.playNumber) { await page.keyboard.press(KEYS[def].hands); handsFlight = s.playNumber; seen.hands++; }
                await hold(page, held, new Set([...toward(off, carrier, carrier), ...defWant]));
            }
            else {
                const defWant = toward(def, defender, carrier, 0.4);
                if (throwPlay === s.playNumber && s.ball.kind === 'held' && carrier.number === 1 && s.liveTicks >= 6) { await page.keyboard.press(KEYS[off].pass); seen.passes++; throwPlay = -1; }
                await hold(page, held, new Set([...offWant, ...defWant]));
            }
            await page.clock.runFor(120);
        }
        else if (s.phase === 'dead') {
            await hold(page, held, new Set());
            const r = s.result!;
            if (r.touchdown) seen.touchdowns++;
            if (r.turnover || r.turnoverOnDowns) seen.turnovers++;
            if (r.firstDown) seen.firstDowns++;
            if (r.reason === 'safety') safety++;
            if (!seen.reloaded && s.quarter === 2 && s.down === 2) {
                seen.reloaded = true;
                await page.reload();
                await page.clock.runFor(200);
                expect(await saved(page), 'a mid-game reload restores the finished down exactly').toEqual(s);
            }
            await button(page, 'Next down').click();
        }
        else if (s.phase === 'kick') {
            await hold(page, held, new Set());
            if (s.kick!.good === null) {
                const ph = s.kick!.ticks % 100;
                if (Math.abs(ph - 25) <= 3 || Math.abs(ph - 75) <= 3) await page.keyboard.press(KEYS[s.kick!.team].kick);
                else await page.clock.runFor(32);
            }
            else await button(page, 'Next down').click();
        }
        s = await saved(page);
    }
    await hold(page, held, new Set());
    expect(s.phase, 'the game must reach its final').toBe('final');
    // The whole structure of a game was played through the real UI.
    expect([...seen.quarters].sort()).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(seen.halftimeOffense, 'the team that did not open receives the second half at its own 28').toBe('away@82');
    expect(s.terminalCount).toBeGreaterThan(40);
    expect(seen.passes, 'the offense threw').toBeGreaterThan(3);
    expect(seen.hands, 'the defense went for the ball').toBeGreaterThan(0);
    expect(seen.kicksXp + seen.kicksFg, 'a kick was made through the meter').toBeGreaterThan(0);
    expect(seen.firstDowns).toBeGreaterThan(3);
    expect(s.score.home + s.score.away, 'points were scored').toBeGreaterThan(0);
    const { home, away } = s.score;
    expect(s.winner).toBe(home > away ? 'home' : away > home ? 'away' : 'draw');
    await expect(page.getByTestId('final')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText(`Bluebirds ${home} – ${away} Foxes`);
    // A reload at game over repeats nothing; a rematch is a clean game.
    await page.reload();
    await page.clock.runFor(200);
    expect(await saved(page)).toEqual(s);
    await button(page, 'Rematch').click();
    expect(await saved(page)).toMatchObject({ phase: 'pre-snap', quarter: 1, clock: 1800, score: { home: 0, away: 0 } });
    test.info().annotations.push({ type: 'game', description: `final ${home}-${away}, ${s.terminalCount} completed plays, overtime ${seen.overtime}, xp ${seen.kicksXp}, fg ${seen.kicksFg}/${seen.fgTried} tried, passes ${seen.passes}, hands ${seen.hands}, touchdowns ${seen.touchdowns}, safeties ${safety}, turnovers ${seen.turnovers}` });
    console.log('GAME', test.info().annotations.at(-1)!.description);
});
