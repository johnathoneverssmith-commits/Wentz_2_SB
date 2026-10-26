import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import type { DownState } from '../core/down';
import { button, kickBadly, saved, startClocked } from './helpers';

// Four real quarters of three live minutes each (43,200 simulation ticks) plus every kick, played through the
// real page. The page draws ten frames a second here so the game finishes in minutes; the simulation still steps
// at 1/60 s, so this is the same game on a slower screen.
test.setTimeout(900_000);

const KEYS = {
    home: { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', pass: 'KeyQ', hands: 'KeyR', kick: 'KeyG' },
    away: { left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', pass: 'Comma', hands: 'ShiftRight', kick: 'Quote' },
} as const;
const MID = 26.67;
/** The quarterback sits in the pocket this many ticks (1.5 s), then throws: the late window of the go routes. */
const THROW_AT = 90;
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
    await startClocked(page, undefined, { frameMs: 100 });
    // One jump per drawn frame: the page steps the simulation six ticks for each 100 ms it is shown.
    const run = async (ms: number) => { for (let t = 0; t < ms; t += 100) await page.clock.fastForward(100); };
    const started = Date.now();
    const held = new Set<string>();
    const seen = { quarters: new Set<number>(), kicksXp: 0, kicksFg: 0, passes: 0, hands: 0, fgTried: 0, touchdowns: 0, turnovers: 0, firstDowns: 0, halftimeOffense: '', overtime: false, reloaded: false, reloads: 0, clockMovedBetweenDowns: 0 };
    let handsFlight = -1, lastTerminal = 0, safety = 0;
    let prev: DownState | null = null;
    let s = await saved(page);
    for (let i = 0; i < 6000 && s.phase !== 'final'; i++) {
        seen.quarters.add(s.quarter);
        if (i % 500 === 0) console.log(`PROGRESS i=${i} t=${((Date.now() - started) / 1000).toFixed(0)}s q=${s.quarter} clock=${s.clock} play=${s.playNumber} phase=${s.phase} score=${s.score.home}-${s.score.away}`);
        if (s.mode === 'overtime') seen.overtime = true;
        if (s.quarter === 3 && s.phase === 'pre-snap' && !seen.halftimeOffense) seen.halftimeOffense = `${s.offense}@${s.line}`;
        // Between plays the clock may spend at most the six-second allowance: from a finished play to the next read, no more.
        if (prev && prev.phase === 'dead' && s.phase !== 'live' && prev.quarter === s.quarter && prev.mode === 'regulation' && prev.clock - s.clock > 360) seen.clockMovedBetweenDowns++;
        if (s.terminalCount !== lastTerminal) {
            lastTerminal = s.terminalCount;
            if (s.kick?.kind === 'xp' && s.kick.good !== null) seen.kicksXp++;
            if (s.kick?.kind === 'fg' && s.kick.good !== null) seen.kicksFg++;
        }
        prev = s;
        if (s.phase === 'pre-snap') {
            await hold(page, held, new Set());
            const yardsToGoal = s.offense === 'home' ? 110 - s.line : s.line - 10;
            const toGo = Math.abs(s.firstDownLine - s.line);
            let choice: string;
            // Bluebirds kick on fourth down when it is in range; Foxes always go for it, so two otherwise identical teams cannot tie forever.
            if (s.offense === 'home' && s.down === 4 && yardsToGoal <= 40 && (toGo > 3 || yardsToGoal < 35)) { choice = 'fieldgoal'; seen.fgTried++; }
            else choice = 'go';
            if (s.play !== choice) await page.getByLabel('Play', { exact: true }).selectOption(choice);
            await page.keyboard.press('Enter');
            handsFlight = -1;
        }
        else if (s.phase === 'live') {
            const off = s.offense, def = other(off), carrier = at(s, s.possession.carrier), defender = at(s, s.defender);
            if (s.ball.kind === 'held' && carrier.position === 'QB' && s.play !== 'rush') {
                // In the pocket: both humans wait, then the quarterback throws late.
                await hold(page, held, new Set());
                if (s.liveTicks < THROW_AT) await run(Math.max(100, Math.ceil(((THROW_AT - s.liveTicks) * 1000) / 60)));
                else { await page.keyboard.press(KEYS[off].pass); seen.passes++; await run(100); }
            }
            else if (s.ball.kind === 'flight') {
                // The defender goes to the landing circle and presses Hands as the ball comes down.
                await hold(page, held, toward(def, defender, s.ball.to, 0.4));
                if (s.ball.elapsed > 0.45 && handsFlight !== s.playNumber) { await page.keyboard.press(KEYS[def].hands); handsFlight = s.playNumber; seen.hands++; }
                await run(s.ball.elapsed > 0.45 ? 400 : Math.ceil((0.5 - s.ball.elapsed) * 1000));
            }
            else {
                // After the catch (or a run): the carrier heads for the goal line and the defender chases.
                const goalX = off === 'home' ? 112 : 8;
                const offWant = toward(off, carrier, { x: goalX, y: Math.abs(carrier.y - MID) > 5 ? MID : carrier.y });
                await hold(page, held, new Set([...offWant, ...toward(def, defender, carrier, 0.4)]));
                await run(400);
            }
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
                seen.reloads++;
                await page.reload();
                await page.clock.runFor(300);
                expect(await saved(page), 'a mid-game reload restores the finished down exactly').toEqual(s);
                await expect(page.getByTestId('phase')).toHaveText('Paused');
                await page.getByRole('button', { name: 'Resume', exact: true }).click();
            }
            await page.keyboard.press('Enter');
        }
        else if (s.phase === 'kick') {
            await hold(page, held, new Set());
            if (s.kick!.good === null) {
                // Foxes' kicker has a bad day on every extra point (the first instant of the meter); every other kick waits for the centre.
                if (s.kick!.team === 'away' && s.kick!.kind === 'xp') await kickBadly(page, KEYS.away.kick);
                else {
                    const ph = s.kick!.ticks % 100;
                    if (Math.abs(ph - 25) <= 3 || Math.abs(ph - 75) <= 3) await page.keyboard.press(KEYS[s.kick!.team].kick);
                    else await run(100);
                }
            }
            else await page.keyboard.press('Enter');
        }
        s = await saved(page);
    }
    await hold(page, held, new Set());
    expect(seen.reloads, 'the mid-game reload (and its exact restore) really happened').toBe(1);
    expect(s.phase, 'the game must reach its final').toBe('final');
    // The whole structure of a game was played through the real UI.
    expect([...seen.quarters].sort()).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(seen.halftimeOffense, 'the team that did not open receives the second half at its own 28').toBe('away@82');
    expect(s.terminalCount).toBeGreaterThan(40);
    expect(seen.passes, 'the offense threw').toBeGreaterThan(20);
    expect(seen.hands, 'the defense went for the ball').toBeGreaterThan(0);
    expect(seen.kicksXp + seen.kicksFg, 'a kick was made through the meter').toBeGreaterThan(0);
    expect(seen.touchdowns).toBeGreaterThan(0);
    expect(seen.clockMovedBetweenDowns, 'the clock never ran past the allowance between plays').toBe(0);
    expect(s.score.home + s.score.away, 'points were scored').toBeGreaterThan(0);
    const { home, away } = s.score;
    expect(home).not.toBe(away);
    expect(s.winner).toBe(home > away ? 'home' : 'away');
    await expect(page.getByTestId('final')).toBeVisible();
    await expect(page.getByTestId('final-score')).toHaveText(`Bluebirds ${home} – ${away} Foxes`);
    // A reload at game over repeats nothing; a rematch is a clean game.
    await page.reload();
    await page.clock.runFor(300);
    expect(await saved(page)).toEqual(s);
    await button(page, 'Rematch').click();
    expect(await saved(page)).toMatchObject({ phase: 'pre-snap', quarter: 1, clock: 10800, score: { home: 0, away: 0 } });
    const note = `final ${home}-${away}, ${s.terminalCount} completed plays, overtime ${seen.overtime}, xp ${seen.kicksXp}, fg ${seen.kicksFg}/${seen.fgTried} tried, passes ${seen.passes}, hands ${seen.hands}, touchdowns ${seen.touchdowns}, safeties ${safety}, turnovers ${seen.turnovers}, ${((Date.now() - started) / 1000).toFixed(0)} s`;
    test.info().annotations.push({ type: 'game', description: note });
    console.log('GAME', note);
});
