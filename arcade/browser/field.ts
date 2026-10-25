/**
 * Milestone 5A renderer: an elevated side view in a 480x270 pixel canvas (16:9). It only reads the match state; it never advances
 * gameplay and owns no match state. Per-player animation, camera, particles and banners live here and are derived from state
 * changes between frames, so the simulation, saves and tests are unaffected.
 */
import { FIELD } from '../core/simulation';
import type { PlayerId, TeamId } from '../core/simulation';
import { direction, engagements, type DownState } from '../core/down';
import { followCamera, viewLeftPx } from './render/camera';
import { drawText } from './render/font';
import { Banner, drawBanner, drawHints, drawKickMeter, drawScoreboard, TEAM_NAMES } from './render/hud';
import { identityOf, positionOf } from './render/roster';
import { ANIMS, drawSprite, frameFor, frameIndex, TEAM_COLORS, type Anim, type Look } from './render/sprites';
import { BAND_TOP, COLORS, H, PPY, ROW, W, screenY, standsStrip, turfStrip, worldX } from './render/world';

const SELECT_COLOR: Record<TeamId, string> = { home: '#7ff0ff', away: '#ffd36b' };
interface Actor { x: number; y: number; face: 1 | -1; speed: number; run: number; anim: Anim; since: number; override: number | null }
interface Particle { x: number; y: number; vx: number; vy: number; born: number; life: number; color: string; size: number; gravity: number }
interface PlayEvents { throwAt: number | null; catchAt: number | null; catcher: PlayerId | null; endAt: number | null; tackler: PlayerId | null; kickAt: number | null; kickBanner: boolean }
const fresh = (): PlayEvents => ({ throwAt: null, catchAt: null, catcher: null, endAt: null, tackler: null, kickAt: null, kickBanner: false });
const reduced = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function pixelEllipse(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, color: string, filled = false) {
    ctx.fillStyle = color;
    if (filled) {
        for (let dy = -ry; dy <= ry; dy++) {
            const half = Math.round(rx * Math.sqrt(1 - (dy / (ry + 0.5)) ** 2));
            ctx.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2 + 1, 1);
        }
        return;
    }
    const steps = Math.max(24, rx * 4);
    for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        ctx.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
}

export class Renderer {
    private cam = 0;
    private camInit = false;
    private lastNow: number | null = null;
    private presentationNow = 0;
    private shake = { x: 0, y: 0 };
    private prev: DownState | null = null;
    private actors = new Map<PlayerId, Actor>();
    private ev: PlayEvents = fresh();
    private particles: Particle[] = [];
    private banners: Banner[] = [];
    private floaters: { text: string; x: number; y: number; born: number; color: string }[] = [];
    private shakeUntil = 0;
    private dustAt = 0;
    private celebrateUntil = 0;
    private celebrateTeam: TeamId = 'home';
    private rand = 12345;

    private random(): number { this.rand = (this.rand * 1664525 + 1013904223) >>> 0; return this.rand / 4294967296; }

    draw(canvas: HTMLCanvasElement, s: DownState, paused: boolean, now: number): void {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        ctx.imageSmoothingEnabled = false;
        const elapsed = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
        this.lastNow = now;
        if (!paused) this.presentationNow += elapsed;
        now = this.presentationNow;
        const dt = paused ? 0 : Math.min(0.1, elapsed / 1000);
        if (!paused) this.observe(s, now);
        this.updateActors(s, now, dt, paused);
        this.moveCamera(s, dt, paused, now);
        if (!paused) this.shake = !reduced() && now < this.shakeUntil ? { x: Math.round((this.random() - 0.5) * 3), y: Math.round((this.random() - 0.5) * 3) } : { x: 0, y: 0 };
        const shake = this.shake;
        ctx.save();
        ctx.translate(shake.x, shake.y);
        this.drawScene(ctx, s, now);
        ctx.restore();
        if (s.phase === 'kick' && s.kick) drawKickMeter(ctx, s);
        this.banners = this.banners.filter(b => drawBanner(ctx, b, now));
        drawScoreboard(ctx, s, now);
        drawHints(ctx, s);
        if (s.phase === 'final') this.drawFinal(ctx, s, now);
        if (paused) {
            ctx.fillStyle = 'rgba(8,10,28,.7)'; ctx.fillRect(0, 0, W, H);
            drawText(ctx, 'TIMEOUT', W / 2, H / 2 - 12, { color: COLORS.gold, scale: 6, align: 'center', shadow: '#000' });
            drawText(ctx, 'PRESS RESUME TO PLAY', W / 2, H / 2 + 24, { color: '#fff6dc', scale: 1, align: 'center' });
        }
        this.prev = s;
    }

    // ---------- events: derived from changes between frames ----------
    private observe(s: DownState, now: number): void {
        const p = this.prev;
        if (!p) return;
        if (s.playNumber !== p.playNumber || (s.phase === 'pre-snap' && p.phase !== 'pre-snap') || (s.phase === 'live' && p.phase === 'pre-snap')) this.ev = fresh();
        if (p.ball.kind === 'held' && s.ball.kind === 'flight') this.ev.throwAt = now;
        if (p.ball.kind === 'flight' && s.ball.kind === 'held') {
            this.ev.catchAt = now; this.ev.catcher = s.possession.carrier;
            const c = this.actors.get(s.possession.carrier);
            if (c) this.burst(c.x, c.y, 8, ['#ffffff', '#ffe28a', '#9bd0ff'], now, 14);
        }
        if (p.phase === 'live' && s.phase === 'dead' && s.result) this.playEnded(s, now);
        if (s.phase === 'kick' && s.kick && p.kick && p.kick.good === null && s.kick.good !== null) this.ev.kickAt = now;
        if (s.quarter !== p.quarter && s.phase !== 'final') {
            const label = s.mode === 'overtime' ? 'OVERTIME' : s.quarter === 3 ? 'SECOND HALF' : `QUARTER ${s.quarter}`;
            this.banners.push({ text: label, sub: s.quarter === 3 && s.mode !== 'overtime' ? `${TEAM_NAMES[s.offense]} RECEIVE` : undefined, color: '#3b4a99', born: now, hold: 0.9 });
        }
        if (s.phase === 'kick' && s.kick && s.kick.good !== null && this.ev.kickAt !== null && !this.ev.kickBanner && now - this.ev.kickAt > 1050) {
            this.ev.kickBanner = true;
            this.banners.push({ text: s.kick.good ? 'IT IS GOOD!' : 'NO GOOD', sub: s.kick.good ? (s.kick.kind === 'xp' ? 'EXTRA POINT' : 'FIELD GOAL +3') : undefined, color: s.kick.good ? '#1f9d55' : '#b83232', born: now, hold: 0.9 });
            if (s.kick.good) { this.celebrateUntil = now + 1500; this.celebrateTeam = s.kick.team; this.confetti(s.kick.team, now); }
        }
    }
    private playEnded(s: DownState, now: number): void {
        const r = s.result!, carrier = this.actors.get(s.possession.carrier);
        this.ev.endAt = now;
        if (r.touchdown) {
            this.banners.push({ text: 'TOUCHDOWN!', sub: `${TEAM_NAMES[s.offense].toUpperCase()} +6`, color: TEAM_COLORS[s.offense].jersey, born: now, hold: 1.2 });
            this.confetti(s.offense, now); this.celebrateUntil = now + 2200; this.celebrateTeam = s.offense; this.shakeUntil = now + 220;
        }
        else if (r.reason === 'interception') { this.banners.push({ text: 'INTERCEPTED!', sub: 'TURNOVER', color: '#b83232', born: now, hold: 1 }); this.shakeUntil = now + 160; }
        else if (r.reason === 'safety') this.banners.push({ text: 'SAFETY!', sub: '+2', color: '#b83232', born: now, hold: 1 });
        else if (r.turnoverOnDowns) this.banners.push({ text: 'TURNOVER ON DOWNS', color: '#8c3a8c', born: now, hold: 0.9 });
        else if (r.firstDown) this.banners.push({ text: 'FIRST DOWN!', color: '#b88a00', born: now, hold: 0.55 });
        else if (r.reason === 'incomplete') {
            const t = this.actors.get(s.ball.kind === 'flight' ? s.ball.target : s.possession.carrier);
            if (t) this.floaters.push({ text: 'INCOMPLETE', x: t.x, y: t.y, born: now, color: '#e9ecff' });
        }
        if (carrier && (r.reason === 'tackle' || r.reason === 'safety')) {
            const tackle = s.players.filter(q => q.team !== s.possession.team).map(q => ({ q, d: Math.hypot(q.x - carrier.x, q.y - carrier.y) })).sort((a, b) => a.d - b.d)[0];
            this.ev.tackler = tackle?.q.id ?? null;
            this.burst(carrier.x, carrier.y, 10, ['#ffe28a', '#ffffff', '#ff8f6b'], now, 16);
            this.shakeUntil = Math.max(this.shakeUntil, now + 140);
        }
    }
    private confetti(team: TeamId, now: number): void {
        const pal = [TEAM_COLORS[team].jersey, TEAM_COLORS[team].light, '#ffd24a', '#ffffff'], n = reduced() ? 14 : 48;
        for (let i = 0; i < n; i++) {
            const x = worldX(this.cam) + (this.random() - 0.5) * W;
            this.particles.push({ x, y: BAND_TOP - 100 + this.random() * 30, vx: (this.random() - 0.5) * 30, vy: 20 + this.random() * 40, born: now, life: 1.6 + this.random(), color: pal[i % pal.length]!, size: 2, gravity: 14 });
        }
    }
    private burst(x: number, y: number, n: number, colors: string[], now: number, speed: number): void {
        const count = reduced() ? Math.ceil(n / 3) : n;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + this.random();
            this.particles.push({ x: worldX(x), y: screenY(y) - 20, vx: Math.cos(a) * speed * (0.5 + this.random()), vy: Math.sin(a) * speed * (0.5 + this.random()), born: now, life: 0.4, color: colors[i % colors.length]!, size: 2, gravity: 30 });
        }
    }

    // ---------- actors ----------
    private updateActors(s: DownState, now: number, dt: number, paused: boolean): void {
        const engaged = new Set<string>();
        if (s.phase === 'live') for (const e of engagements(s)) { engaged.add(e.blocker); engaged.add(e.defender); }
        const attackDir = direction(s.offense);
        for (const p of s.players) {
            let a = this.actors.get(p.id);
            const home: 1 | -1 = p.team === s.offense ? (attackDir as 1 | -1) : (-attackDir as 1 | -1);
            if (!a) { a = { x: p.x, y: p.y, face: home, speed: 0, run: 0, anim: 'idle', since: now, override: null }; this.actors.set(p.id, a); }
            const dx = p.x - a.x, dy = p.y - a.y, moved = Math.hypot(dx, dy);
            if (moved > 6 || (s.phase === 'pre-snap' && moved > 0.01 && (this.prev?.phase !== 'pre-snap'))) { a.speed = 0; a.face = home; }
            else if (!paused && dt > 0) {
                a.speed = a.speed * 0.5 + (moved / dt) * 0.5;
                a.run += moved;
                if (Math.abs(dx) > 0.004) a.face = dx > 0 ? 1 : -1;
            }
            a.x = p.x; a.y = p.y;
            if (!paused) this.chooseAnim(a, p.id, p.team, p.number, s, now, engaged);
            if (!paused && a.speed > 4.5 && now - this.dustAt > 90 && s.phase === 'live') {
                this.particles.push({ x: worldX(a.x) - a.face * 6, y: screenY(a.y) - 1, vx: -a.face * 6, vy: -6, born: now, life: 0.35, color: 'rgba(214,196,150,.8)', size: 2, gravity: 0 });
            }
        }
        if (now - this.dustAt > 90) this.dustAt = now;
        const dts = dt;
        this.particles = this.particles.filter(q => now - q.born < q.life * 1000);
        for (const q of this.particles) { q.x += q.vx * dts; q.y += q.vy * dts; q.vy += q.gravity * dts; }
    }
    private set(a: Actor, anim: Anim, now: number, override: number | null = null): void {
        if (a.anim !== anim) { a.anim = anim; a.since = now; }
        a.override = override;
    }
    private chooseAnim(a: Actor, id: PlayerId, team: TeamId, number: number, s: DownState, now: number, engaged: Set<string>): void {
        const ev = this.ev, since = (t: number | null) => t === null ? Infinity : (now - t) / 1000;
        const touchdown = !!s.result?.touchdown && (s.phase === 'dead' || s.phase === 'kick' || s.phase === 'final') && team === s.offense;
        if ((touchdown || (now < this.celebrateUntil && team === this.celebrateTeam)) && s.phase !== 'live') return this.set(a, 'celebrate', now);
        if (s.phase === 'dead' || s.phase === 'final') {
            const r = s.result;
            if (r && id === s.possession.carrier && (r.reason === 'tackle' || r.reason === 'safety') && !r.touchdown) return this.set(a, 'fall', now);
            if (id === ev.tackler && !r?.touchdown) return this.set(a, 'tackle', now);
            if (r?.reason === 'interception' && id === s.possession.carrier) return this.set(a, since(ev.endAt) < 0.6 ? 'catch' : 'celebrate', now, since(ev.endAt) < 0.6 ? 1 : null);
            if (r?.reason === 'incomplete' && s.ball.kind === 'flight' && id === s.ball.target && since(ev.endAt) < 0.5) return this.set(a, 'catch', now, 0);
            return this.set(a, a.speed > 0.9 ? 'run' : 'idle', now);
        }
        if (s.phase === 'live') {
            if (ev.catchAt !== null && ev.catcher === id && since(ev.catchAt) < 0.35) return this.set(a, 'catch', now, 1);
            if (s.ball.kind === 'flight' && id === s.ball.target && s.ball.elapsed / s.ball.duration > 0.55) return this.set(a, 'catch', now, 0);
            if (id === `${s.offense}-1` && ev.throwAt !== null && since(ev.throwAt) < 0.45) return this.set(a, 'throw', now, since(ev.throwAt) < 0.2 ? 1 : 2);
            if (id === `${s.offense}-1` && s.ball.kind === 'held' && s.possession.carrier === id && s.play !== 'rush' && a.speed < 1.2) return this.set(a, 'throw', now, 0);
            if (engaged.has(id)) return this.set(a, 'block', now);
        }
        if (a.speed > 0.9) return this.set(a, 'run', now);
        return this.set(a, 'idle', now);
    }
    private frameOf(a: Actor, now: number, seed: number): number {
        if (a.override !== null) return a.override;
        if (a.anim === 'run') return Math.floor(a.run / 0.55) % ANIMS.run.poses.length;
        const t = (now - a.since) / 1000;
        return frameIndex(a.anim, a.anim === 'idle' ? t + seed * 0.37 : a.anim === 'fall' ? Math.max(0, t - 0.1) : t);
    }

    // ---------- camera ----------
    private moveCamera(s: DownState, dt: number, paused: boolean, now: number): void {
        let target = s.line;
        const dir = direction(s.offense);
        if (s.phase === 'kick' && s.kick) {
            const kdir = direction(s.kick.team), spot = this.kickSpot(s);
            const goal = kdir > 0 ? FIELD.length : 0;
            const t = this.ev.kickAt === null ? 0 : Math.max(0, Math.min(1, (now - this.ev.kickAt - 180) / 1000));
            target = t === 0 ? spot - kdir * 7 + kdir * 10 : spot - kdir * 3 + (goal - (spot - kdir * 3)) * t + kdir * 4;
            // Cut to the setup so the kicker is visible immediately, even after a distant touchdown.
            if (this.prev?.phase !== 'kick' && !paused) { this.cam = followCamera(target, target, 0); this.camInit = true; return; }
        }
        else if (s.phase === 'live' || s.phase === 'dead') {
            const carrier = this.actors.get(s.possession.carrier);
            target = s.ball.kind === 'flight' ? s.ball.from.x + (s.ball.to.x - s.ball.from.x) * Math.min(1, s.ball.elapsed / s.ball.duration) : carrier?.x ?? s.line;
            if (s.phase === 'live') target += dir * (s.play === 'rush' || s.ball.kind === 'flight' ? 3.5 : 12);
        }
        else target = s.line + dir * (s.play === 'rush' ? 3.5 : 10);
        if (!this.camInit) { this.cam = followCamera(target, target, 0); this.camInit = true; return; }
        if (!paused) this.cam = followCamera(this.cam, target, dt);
    }

    // ---------- scene ----------
    private drawScene(ctx: CanvasRenderingContext2D, s: DownState, now: number): void {
        const left = viewLeftPx(this.cam), sx = (yardX: number) => worldX(yardX) - left;
        const crowdFrame = (Math.floor(now / (now < this.celebrateUntil ? 160 : 520)) % 2) as 0 | 1;
        ctx.fillStyle = '#0b1030'; ctx.fillRect(0, 0, W, H);
        ctx.drawImage(standsStrip(crowdFrame), Math.round(left * 0.55), 0, W, BAND_TOP, 0, 0, W, BAND_TOP);
        ctx.drawImage(turfStrip(), left, 0, W, H, 0, 0, W, H);
        // line of scrimmage and first-down line, drawn on the turf
        const dir = direction(s.offense);
        this.vline(ctx, sx(s.line), '#53c7ff', 2, 3);
        if (s.firstDownLine !== s.line) this.vline(ctx, sx(s.firstDownLine), '#ffd24a', 3, 0);
        if (s.firstDownLine * dir < 110 * (dir > 0 ? 1 : 0) + 10 * (dir < 0 ? 1 : 0)) {
            ctx.fillStyle = '#ffd24a'; ctx.fillRect(sx(s.firstDownLine) - 1, BAND_TOP - 14, 3, 14); ctx.fillRect(sx(s.firstDownLine) - 3, BAND_TOP - 16, 7, 3);
        }
        this.drawPosts(ctx, sx(0)); this.drawPosts(ctx, sx(120));
        // contested-catch and landing markers on the turf
        if (s.ball.kind === 'flight') {
            const dashOn = Math.floor(now / 120) % 2 === 0;
            pixelEllipse(ctx, sx(s.ball.to.x), screenY(s.ball.to.y), Math.round(2.2 * PPY), Math.round(2.2 * ROW), dashOn ? '#fff1b0' : '#c9a85a');
        }
        if (s.phase === 'live' && s.contestUntil >= s.tick && s.contestUntil > 0) {
            const d = s.players.find(q => q.id === s.defender)!;
            pixelEllipse(ctx, sx(d.x), screenY(d.y), Math.round(2.2 * PPY), Math.round(2.2 * ROW), '#ffffff');
        }
        const looks = new Map<PlayerId, Look>();
        for (const p of s.players) looks.set(p.id, { team: p.team, number: p.number, skin: identityOf(p.id).skin });
        // shadows then selection circles (beneath the sprites)
        for (const p of s.players) {
            const x = sx(p.x), y = screenY(p.y);
            pixelEllipse(ctx, x, y, 10, 4, 'rgba(0,0,0,.35)', true);
        }
        for (const p of s.players.filter(q => q.human)) {
            const pulse = Math.floor(now / 250) % 2;
            pixelEllipse(ctx, sx(p.x), screenY(p.y), 15 + pulse, 6 + pulse, SELECT_COLOR[p.team]);
            pixelEllipse(ctx, sx(p.x), screenY(p.y), 14 + pulse, 5 + pulse, 'rgba(255,255,255,.55)');
        }
        // players sorted back-to-front; the ball carrier's ball is drawn with him
        const order = [...s.players].sort((a, b) => a.y - b.y);
        const kicker = s.phase === 'kick' && s.kick ? this.kickerSprite(s) : null;
        let kickerDrawn = false;
        for (const p of order) {
            if (kicker && !kickerDrawn && kicker.y <= p.y) { this.drawKicker(ctx, kicker, s, now, sx); kickerDrawn = true; }
            const a = this.actors.get(p.id)!, look = looks.get(p.id)!;
            const anim = a.anim, idx = this.frameOf(a, now, p.number + (p.team === 'home' ? 0 : 5));
            const frame = frameFor(look, anim, idx);
            drawSprite(ctx, frame, sx(p.x), screenY(p.y), a.face < 0);
            if (p.id === s.possession.carrier && s.ball.kind === 'held' && a.anim !== 'fall') this.drawHeldBall(ctx, sx(p.x), screenY(p.y), a, s.phase);
        }
        if (kicker && !kickerDrawn) this.drawKicker(ctx, kicker, s, now, sx);
        if (s.ball.kind === 'flight') this.drawFlightBall(ctx, s, sx);
        if (s.phase === 'kick' && s.kick) this.drawKickBall(ctx, s, now, sx);
        this.drawLabels(ctx, s, sx, now);
        // blocking engagements: a few sparks where bodies are locked
        if (s.phase === 'live')
            for (const e of engagements(s)) {
                const o = s.players.find(q => q.id === e.blocker)!, d = s.players.find(q => q.id === e.defender)!;
                const mx = (sx(o.x) + sx(d.x)) / 2, my = (screenY(o.y) + screenY(d.y)) / 2 - 12;
                ctx.fillStyle = Math.floor(now / 90) % 2 ? '#ffd24a' : '#fff'; ctx.fillRect(Math.round(mx) - 1, Math.round(my), 3, 1); ctx.fillRect(Math.round(mx), Math.round(my) - 1, 1, 3);
            }
        for (const q of this.particles) {
            const age = (now - q.born) / (q.life * 1000);
            ctx.globalAlpha = Math.max(0, 1 - age * age);
            ctx.fillStyle = q.color; ctx.fillRect(Math.round(q.x - left), Math.round(q.y), q.size, q.size);
        }
        ctx.globalAlpha = 1;
        this.floaters = this.floaters.filter(f => now - f.born < 900);
        for (const f of this.floaters) {
            const age = (now - f.born) / 900;
            drawText(ctx, f.text, sx(f.x), screenY(f.y) - 54 - age * 10, { color: f.color, scale: 1, align: 'center', shadow: '#000' });
        }
        // soft vignette keeps the eye on the action
        const g = ctx.createLinearGradient(0, BAND_TOP + 80, 0, H);
        g.addColorStop(0, 'rgba(5,8,25,0)'); g.addColorStop(1, 'rgba(5,8,25,.28)');
        ctx.fillStyle = g; ctx.fillRect(0, BAND_TOP + 80, W, H - BAND_TOP - 80);
    }
    private vline(ctx: CanvasRenderingContext2D, x: number, color: string, w: number, dash: number): void {
        ctx.fillStyle = color;
        for (let y = BAND_TOP; y < BAND_TOP + 112; y += dash ? dash * 2 : 112) ctx.fillRect(Math.round(x) - 1, y, w, dash || 112);
    }
    private drawPosts(ctx: CanvasRenderingContext2D, x: number): void {
        if (x < -30 || x > W + 30) return;
        const mid = screenY(FIELD.width / 2), a = mid - 8, b = mid + 8, bx = Math.round(x);
        ctx.fillStyle = COLORS.ink; ctx.fillRect(bx - 2, mid - 10, 5, 12);
        ctx.fillStyle = '#ffd24a'; ctx.fillRect(bx - 1, mid - 9, 3, 11);
        ctx.fillStyle = COLORS.ink; ctx.fillRect(bx - 1, a - 41, 4, 33); ctx.fillRect(bx - 1, b - 41, 4, 33); ctx.fillRect(bx - 1, a - 15, 4, b - a + 4);
        ctx.fillStyle = '#ffd24a'; ctx.fillRect(bx, a - 40, 2, 32); ctx.fillRect(bx, b - 40, 2, 32); ctx.fillRect(bx, a - 14, 2, b - a + 2);
        ctx.fillStyle = '#fff6b0'; ctx.fillRect(bx, a - 40, 1, 32); ctx.fillRect(bx, b - 40, 1, 32);
    }
    private drawHeldBall(ctx: CanvasRenderingContext2D, x: number, y: number, a: Actor, phase: DownState['phase']): void {
        const hx = Math.round(x + a.face * 8), hy = Math.round(y - (a.anim === 'throw' ? 30 : 19));
        this.ball(ctx, hx, hy, a.face);
        void phase;
    }
    private ball(ctx: CanvasRenderingContext2D, x: number, y: number, face: number): void {
        ctx.fillStyle = COLORS.ink; ctx.fillRect(x - 4, y - 2, 8, 5);
        ctx.fillStyle = '#9a4f22'; ctx.fillRect(x - 3, y - 1, 6, 3);
        ctx.fillStyle = '#c9783a'; ctx.fillRect(x - 3, y - 1, 6, 1);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1 + (face < 0 ? 0 : 0), y, 2, 1);
    }
    private drawFlightBall(ctx: CanvasRenderingContext2D, s: DownState, sx: (x: number) => number): void {
        if (s.ball.kind !== 'flight') return;
        const b = s.ball, t = Math.min(1, b.elapsed / b.duration);
        const gx = sx(b.from.x + (b.to.x - b.from.x) * t), gy = screenY(b.from.y + (b.to.y - b.from.y) * t);
        const dist = Math.hypot(b.to.x - b.from.x, b.to.y - b.from.y), peak = Math.min(40, 10 + dist * 0.9);
        const h = 20 + Math.sin(t * Math.PI) * peak;
        pixelEllipse(ctx, gx, gy, 3, 1, 'rgba(0,0,0,.4)', true);
        this.ball(ctx, Math.round(gx), Math.round(gy - h), b.to.x >= b.from.x ? 1 : -1);
    }
    private kickerSprite(s: DownState): { x: number; y: number; team: TeamId } {
        const k = s.kick!, dir = direction(k.team);
        return { x: this.kickSpot(s) - dir * 7, y: FIELD.width / 2, team: k.team };
    }
    /** Extra points retain the previous scrimmage spot in match state; only their presentation is relocated. */
    private kickSpot(s: DownState): number {
        const k = s.kick!, dir = direction(k.team), goal = dir > 0 ? FIELD.length : 0;
        return k.kind === 'xp' ? goal - dir * (k.distance - 7) : k.spot;
    }
    private drawKicker(ctx: CanvasRenderingContext2D, k: { x: number; y: number; team: TeamId }, s: DownState, now: number, sx: (x: number) => number): void {
        const face = direction(k.team) < 0;
        const t = this.ev.kickAt === null ? -1 : (now - this.ev.kickAt) / 1000;
        const anim: Anim = t < 0 ? 'idle' : 'kick';
        const look: Look = { team: k.team, number: 1, skin: 1 };
        const idx = anim === 'idle' ? frameIndex('idle', now / 1000) : frameIndex('kick', Math.max(0, t));
        pixelEllipse(ctx, sx(k.x), screenY(k.y), 10, 4, 'rgba(0,0,0,.35)', true);
        pixelEllipse(ctx, sx(k.x), screenY(k.y), 15, 6, SELECT_COLOR[k.team]);
        drawSprite(ctx, frameFor(look, anim, idx), sx(k.x), screenY(k.y), face);
        void s;
    }
    private drawKickBall(ctx: CanvasRenderingContext2D, s: DownState, now: number, sx: (x: number) => number): void {
        const k = s.kick!, dir = direction(k.team), goal = dir > 0 ? FIELD.length : 0, start = this.kickSpot(s) - dir * 3;
        const mid = screenY(FIELD.width / 2);
        if (this.ev.kickAt === null) { this.ball(ctx, Math.round(sx(start)), mid - 3, dir); return; }
        const t = Math.min(1, (now - this.ev.kickAt - 180) / 1000);
        if (t < 0) { this.ball(ctx, Math.round(sx(start)), mid - 3, dir); return; }
        const x = sx(start + (goal - start) * t), side = k.good ? 0 : (k.lockedAt! % 2 ? 1 : -1) * 15 * t * t;
        const h = 4 * 34 * t * (1 - t) + (k.good ? 24 : 8) * t * t + 2;
        pixelEllipse(ctx, x, mid + side, 3, 1, 'rgba(0,0,0,.4)', true);
        this.ball(ctx, Math.round(x), Math.round(mid + side - h), dir);
    }
    private drawLabels(ctx: CanvasRenderingContext2D, s: DownState, sx: (x: number) => number, now: number): void {
        const plates: { x: number; y: number }[] = [];
        for (const p of s.players.filter(q => q.human)) {
            const id = identityOf(p.id), pos = positionOf(p.number, p.team === s.offense);
            const text = `${id.name} ${pos}`, w = text.length * 4 + 5, a = this.actors.get(p.id);
            const hop = a && a.anim === 'celebrate' ? -2 : 0;
            let x = Math.max(2 + w / 2, Math.min(W - 2 - w / 2, sx(p.x))), y = Math.max(46, screenY(p.y) - 56 + hop);
            for (const o of plates) if (Math.abs(o.x - x) < w && Math.abs(o.y - y) < 9) y = o.y - 10;
            plates.push({ x, y });
            const pal = TEAM_COLORS[p.team];
            ctx.fillStyle = COLORS.ink; ctx.fillRect(Math.round(x - w / 2) - 1, y - 1, w + 2, 9);
            ctx.fillStyle = pal.dark; ctx.fillRect(Math.round(x - w / 2), y, w, 7);
            ctx.fillStyle = SELECT_COLOR[p.team]; ctx.fillRect(Math.round(x - w / 2), y, w, 1);
            drawText(ctx, text, x, y + 1, { color: '#ffffff', scale: 1, align: 'center' });
            ctx.fillStyle = SELECT_COLOR[p.team]; ctx.fillRect(Math.round(sx(p.x)) - 1, y + 8, 3, 2); ctx.fillRect(Math.round(sx(p.x)), y + 10, 1, 1);
        }
        // pass options while the quarterback holds the ball
        const qb = s.players.find(q => q.id === `${s.offense}-1`);
        if (qb && s.play !== 'rush' && s.play !== 'fieldgoal' && (s.phase === 'pre-snap' || (s.phase === 'live' && s.ball.kind === 'held' && s.possession.carrier === qb.id))) {
            const keys = s.offense === 'home' ? ['Q', 'E'] : [',', '.'];
            for (const [i, n] of [3, 4].entries()) {
                const r = s.players.find(q => q.id === `${s.offense}-${n}`)!;
                const x = Math.round(sx(r.x)), y = Math.round(screenY(r.y)) - 52 + (Math.floor(now / 300) % 2);
                ctx.fillStyle = COLORS.ink; ctx.fillRect(x - 5, y - 1, 11, 10);
                ctx.fillStyle = '#e6ebff'; ctx.fillRect(x - 4, y, 9, 8);
                drawText(ctx, keys[i]!, x, y + 1, { color: COLORS.ink, scale: 1, align: 'center' });
            }
        }
        // a marker over the ball carrier when he is not already named
        const carrier = s.players.find(q => q.id === s.possession.carrier);
        if (carrier && !carrier.human && s.phase === 'live') {
            const x = Math.round(sx(carrier.x)), y = Math.round(screenY(carrier.y)) - 52 + (Math.floor(now / 250) % 2);
            ctx.fillStyle = '#ffd24a'; ctx.fillRect(x - 3, y, 7, 1); ctx.fillRect(x - 2, y + 1, 5, 1); ctx.fillRect(x - 1, y + 2, 3, 1); ctx.fillRect(x, y + 3, 1, 1);
        }
    }
    private drawFinal(ctx: CanvasRenderingContext2D, s: DownState, now: number): void {
        ctx.fillStyle = 'rgba(8,10,28,.55)'; ctx.fillRect(0, 56, W, 86);
        drawText(ctx, 'FINAL', W / 2, 66, { color: COLORS.gold, scale: 8, align: 'center', shadow: '#000' });
        const w = s.winner as TeamId;
        drawText(ctx, `${TEAM_NAMES[w]} WIN ${s.score[w]}-${s.score[w === 'home' ? 'away' : 'home']}`, W / 2, 118, { color: TEAM_COLORS[w].light, scale: 2, align: 'center', shadow: '#000' });
        void now;
    }
}
const shared = new Renderer();
/** Draw one frame. `now` is the animation-frame time in milliseconds. */
export function drawField(canvas: HTMLCanvasElement, state: DownState, paused: boolean, now: number = performance.now()): void {
    shared.draw(canvas, state, paused, now);
}
