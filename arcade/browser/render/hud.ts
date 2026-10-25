/** On-canvas scoreboard, control hints, kick meter and banners, all drawn with the pixel font so the whole screen shares one style. */
import { clockText, situation, type DownState } from '../../core/down';
import { KICK_MAX_TICKS, kickTolerance, meterAt } from '../../core/kick';
import type { TeamId } from '../../core/simulation';
import { drawText, textWidth } from './font';
import { COLORS, H, W } from './world';
import { TEAM_COLORS } from './sprites';

export const TEAM_NAMES: Record<TeamId, string> = { home: 'Bluebirds', away: 'Foxes' };
const ordinal = (n: number) => ['1ST', '2ND', '3RD', '4TH'][n - 1] ?? `${n}TH`;

/** "BLU 35", "50", "FOX 20": the yard line from the nearer goal, labelled by the side of the field it is on. */
export function fieldPosition(line: number): string {
    const fromHome = Math.round(line - 10);
    if (fromHome === 50) return '50';
    return fromHome < 50 ? `BLU ${fromHome}` : `FOX ${100 - fromHome}`;
}
export function periodText(s: DownState): string {
    return s.mode === 'overtime' ? 'OT' : `Q${s.quarter}`;
}
export function downText(s: DownState): string {
    const sit = situation(s);
    return `${ordinal(s.down)} & ${sit.goalToGo ? 'GOAL' : Math.ceil(sit.toGo)}`;
}
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, edge: string) {
    ctx.fillStyle = COLORS.ink; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = edge; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(x + 1, y + 1, w - 2, 1);
}
export function drawScoreboard(ctx: CanvasRenderingContext2D, s: DownState, now: number): void {
    const y = 6, h = 34, bw = 104, cw = 124, total = bw * 2 + cw + 4, x0 = Math.round((W - total) / 2);
    const blocks: [TeamId, number][] = [['home', x0], ['away', x0 + bw + cw + 4]];
    for (const [team, bx] of blocks) {
        const pal = TEAM_COLORS[team];
        panel(ctx, bx, y, bw, h, COLORS.panel, pal.light);
        ctx.fillStyle = pal.jersey; ctx.fillRect(bx + 2, y + 2, 4, h - 4);
        drawText(ctx, TEAM_NAMES[team], bx + 10, y + 5, { color: pal.light, scale: 1 });
        drawText(ctx, String(s.score[team]).padStart(2, '0'), bx + bw - 6, y + 14, { color: '#fff6dc', scale: 3, align: 'right', shadow: '#000' });
        if (s.possession.team === team && s.phase !== 'final') {
            // blinking ball icon marks the team with the ball
            if (Math.floor(now / 400) % 2 === 0 || s.phase !== 'live') {
                ctx.fillStyle = '#8a4a22'; ctx.fillRect(bx + 10, y + 21, 7, 4);
                ctx.fillStyle = '#c9783a'; ctx.fillRect(bx + 11, y + 21, 5, 1);
                ctx.fillStyle = '#fff'; ctx.fillRect(bx + 13, y + 22, 1, 2);
            }
        }
    }
    const cx = x0 + bw + 2;
    panel(ctx, cx, y, cw, h, '#0b0f24', COLORS.panelEdge);
    const clock = s.mode === 'overtime' ? 'OT' : clockText(s.clock);
    drawText(ctx, periodText(s), cx + 8, y + 5, { color: COLORS.gold, scale: 2 });
    drawText(ctx, clock, cx + cw - 8, y + 5, { color: s.clock <= 600 && s.mode === 'regulation' ? '#ff6d5a' : '#9bffb4', scale: 2, align: 'right' });
    if (s.phase === 'final')
        drawText(ctx, 'FINAL', cx + cw / 2, y + 19, { color: COLORS.gold, scale: 2, align: 'center' });
    else {
        drawText(ctx, downText(s), cx + 8, y + 18, { color: '#fff6dc', scale: 1 });
        drawText(ctx, fieldPosition(s.line), cx + cw - 8, y + 18, { color: '#9bd0ff', scale: 1, align: 'right' });
        const state = s.phase === 'live' ? 'LIVE' : s.phase === 'kick' ? 'KICK' : s.expired ? 'END OF PERIOD' : s.gap > 0 && s.mode === 'regulation' ? 'CLOCK RUNNING' : 'CLOCK STOPPED';
        drawText(ctx, state, cx + cw / 2, y + 26, { color: s.phase === 'live' ? '#ff8f6b' : '#8aa0cf', scale: 1, align: 'center' });
    }
}
interface Hint { readonly keys: string; readonly text: string }
function hintsFor(s: DownState, team: TeamId): Hint[] {
    const home = team === 'home';
    const move = home ? 'WASD' : 'ARROWS', passKeys = home ? 'Q/E' : ',/.', swap = home ? 'F' : '/', hands = home ? 'R' : 'SHIFT', kick = home ? 'G' : "'";
    const offense = s.offense === team;
    if (s.phase === 'final') return [];
    if (s.phase === 'kick') return s.kick!.team === team && s.kick!.good === null ? [{ keys: kick, text: 'KICK IN THE GREEN' }] : [];
    if (s.phase === 'dead') return [{ keys: 'ENTER', text: 'NEXT DOWN' }];
    if (s.phase === 'pre-snap') return offense ? [{ keys: 'ENTER', text: 'SNAP' }, { keys: move, text: 'MOVE' }] : [{ keys: swap, text: 'SWITCH' }, { keys: move, text: 'MOVE' }];
    if (offense) return s.play === 'rush' || s.ball.kind === 'flight' || !s.possession.carrier.endsWith('-1') ? [{ keys: move, text: 'RUN' }] : [{ keys: passKeys, text: 'PASS' }, { keys: move, text: 'MOVE' }];
    return [{ keys: move, text: 'MOVE' }, { keys: swap, text: 'SWITCH' }, { keys: hands, text: 'HANDS' }];
}
export function drawHints(ctx: CanvasRenderingContext2D, s: DownState): void {
    const y = H - 17;
    ctx.fillStyle = 'rgba(8,10,28,.82)'; ctx.fillRect(0, y - 2, W, 19);
    ctx.fillStyle = COLORS.panelEdge; ctx.fillRect(0, y - 2, W, 1);
    for (const team of ['home', 'away'] as const) {
        const pal = TEAM_COLORS[team], left = team === 'home';
        const items = hintsFor(s, team);
        drawText(ctx, left ? 'P1' : 'P2', left ? 6 : W - 6, y + 4, { color: pal.light, scale: 2, align: left ? 'left' : 'right' });
        let x = left ? 28 : W - 28;
        for (const it of left ? items : [...items].reverse()) {
            const kw = textWidth(it.keys) + 6, tw = textWidth(it.text), total = kw + 4 + tw;
            const bx = left ? x : x - total;
            ctx.fillStyle = COLORS.ink; ctx.fillRect(bx - 1, y, kw + 2, 11);
            ctx.fillStyle = '#e6ebff'; ctx.fillRect(bx, y + 1, kw, 9);
            ctx.fillStyle = '#9aa6d8'; ctx.fillRect(bx, y + 9, kw, 1);
            drawText(ctx, it.keys, bx + 3, y + 3, { color: COLORS.ink, scale: 1 });
            drawText(ctx, it.text, bx + kw + 4, y + 3, { color: '#fff6dc', scale: 1 });
            x += left ? total + 8 : -(total + 8);
        }
    }
}
export function drawKickMeter(ctx: CanvasRenderingContext2D, s: DownState): void {
    const k = s.kick!, cx = Math.round(W / 2), cy = 176, half = 92, tol = kickTolerance(k.distance);
    panel(ctx, cx - half - 14, cy - 34, 2 * half + 28, 74, 'rgba(12,16,40,.92)', COLORS.panelEdge);
    drawText(ctx, `${k.kind === 'xp' ? 'EXTRA POINT' : 'FIELD GOAL'} · ${k.distance} YDS`, cx, cy - 28, { color: COLORS.gold, scale: 1, align: 'center' });
    ctx.fillStyle = '#2a3560'; ctx.fillRect(cx - half, cy - 10, 2 * half, 12);
    ctx.fillStyle = '#35c46a'; ctx.fillRect(Math.round(cx - tol * half), cy - 10, Math.round(2 * tol * half), 12);
    ctx.fillStyle = '#e9f6ee'; ctx.fillRect(cx - 1, cy - 14, 2, 20);
    const at = k.lockedAt ?? k.ticks, pos = Math.round(cx + meterAt(at) * half);
    ctx.fillStyle = k.good === null ? '#ffe28a' : k.good ? '#9bf0b8' : '#ff8a7a';
    for (let i = 0; i < 5; i++) ctx.fillRect(pos - 4 + i, cy - 17 + i, 9 - 2 * i, 1);
    ctx.fillRect(pos - 1, cy - 12, 3, 14);
    ctx.fillStyle = '#44508a'; ctx.fillRect(cx - half, cy + 12, Math.round(2 * half * Math.min(1, at / KICK_MAX_TICKS)), 3);
    const label = k.good === null ? `PRESS ${k.team === 'home' ? 'G' : "'"} IN THE GREEN` : k.good ? 'GOOD!' : 'NO GOOD';
    drawText(ctx, label, cx, cy + 20, { color: k.good === null ? '#fff6dc' : k.good ? '#9bf0b8' : '#ff8a7a', scale: k.good === null ? 1 : 2, align: 'center' });
}
export interface Banner { readonly text: string; readonly sub?: string; readonly color: string; readonly born: number; readonly hold: number }
export function drawBanner(ctx: CanvasRenderingContext2D, b: Banner, now: number): boolean {
    const age = (now - b.born) / 1000, total = 0.28 + b.hold + 0.25;
    if (age < 0 || age > total) return false;
    const slideIn = Math.min(1, age / 0.28), slideOut = Math.max(0, (age - 0.28 - b.hold) / 0.25);
    const ease = 1 - (1 - slideIn) * (1 - slideIn);
    const scale = 4, w = textWidth(b.text, scale) + 24;
    const x = Math.round(W / 2 + (1 - ease) * -W + slideOut * W), y = 52;
    ctx.fillStyle = COLORS.ink; ctx.fillRect(x - w / 2 - 1, y - 3, w + 2, b.sub ? 38 : 30);
    ctx.fillStyle = b.color; ctx.fillRect(x - w / 2, y - 2, w, b.sub ? 36 : 28);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x - w / 2, y + (b.sub ? 22 : 16), w, b.sub ? 12 : 10);
    drawText(ctx, b.text, x, y + 3, { color: '#ffffff', scale, align: 'center', shadow: 'rgba(0,0,0,.55)' });
    if (b.sub) drawText(ctx, b.sub, x, y + 26, { color: '#fff6dc', scale: 1, align: 'center' });
    return true;
}
