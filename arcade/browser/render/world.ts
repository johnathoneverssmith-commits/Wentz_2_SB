/**
 * Static scenery, pre-rendered once into offscreen canvases: pixel-art turf with mowing stripes, yard lines, hash marks,
 * sidelines, end zones, and a lit stadium with a two-frame crowd. The per-frame renderer only blits slices of these.
 */
import { FIELD } from '../../core/simulation';
import { drawText } from './font';
import { TEAM_COLORS } from './sprites';

export const W = 480, H = 270;
/** Screen pixels per yard along the field, and the vertical band the 53.3-yard width is squashed into (elevated side view). */
export const PPY = 9;
export const BAND_TOP = 116, BAND_H = 122;
export const ROW = BAND_H / FIELD.width;
/** The strips cover this many yards beyond each end line so the camera can show the back of the end zones. */
export const MARGIN = 6;
export const STRIP_W = (FIELD.length + 2 * MARGIN) * PPY;
export const worldX = (yard: number) => (yard + MARGIN) * PPY;
export const screenY = (yardY: number) => BAND_TOP + yardY * ROW;

export const COLORS = {
    turfA: '#2f9a45', turfB: '#288a3b', turfFar: '#21752f', line: '#f4f6ee', apron: '#1c5a2b', wall: '#1b2440', wallTrim: '#4a5a8c',
    ink: '#10121f', gold: '#ffd24a', cream: '#fff6dc', panel: '#141a33', panelEdge: '#5b6ccf',
};
const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

let turf: HTMLCanvasElement | null = null;
export function turfStrip(): HTMLCanvasElement {
    if (turf) return turf;
    const c = make(STRIP_W, H), ctx = c.getContext('2d')!, rand = rng(7);
    // Apron / out-of-bounds grass above and below the band.
    ctx.fillStyle = COLORS.apron;
    ctx.fillRect(0, BAND_TOP, STRIP_W, BAND_H + 16 + 40);
    for (let yard = -MARGIN; yard < FIELD.length + MARGIN; yard += 5) {
        const stripe = (yard / 5) & 1;
        ctx.fillStyle = stripe ? COLORS.turfA : COLORS.turfB;
        ctx.fillRect(worldX(yard), BAND_TOP, 5 * PPY, BAND_H);
    }
    // Speckled grass texture and a far-side shadow for depth.
    for (let i = 0; i < 2600; i++) {
        const x = Math.floor(rand() * STRIP_W), y = BAND_TOP + Math.floor(rand() * BAND_H);
        ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.07)';
        ctx.fillRect(x, y, 1, rand() < 0.3 ? 2 : 1);
    }
    for (let y = 0; y < 26; y++) {
        ctx.fillStyle = `rgba(8,30,20,${0.22 * (1 - y / 26)})`;
        ctx.fillRect(0, BAND_TOP + y, STRIP_W, 1);
    }
    // End zones in team colours with the team name painted across them.
    const zones = [{ from: 0, team: 'home' as const, name: 'BLUEBIRDS' }, { from: 110, team: 'away' as const, name: 'FOXES' }];
    for (const z of zones) {
        const pal = TEAM_COLORS[z.team];
        ctx.fillStyle = pal.helmet;
        ctx.fillRect(worldX(z.from), BAND_TOP, 10 * PPY, BAND_H);
        for (let x = 0; x < 10 * PPY; x += 7) {
            ctx.fillStyle = 'rgba(255,255,255,.06)';
            ctx.fillRect(worldX(z.from) + x, BAND_TOP, 3, BAND_H);
        }
        drawText(ctx, z.name, worldX(z.from) + 5 * PPY, BAND_TOP + BAND_H / 2 - 5, { color: pal.helmetLight, scale: 3, stretchY: 0.7, align: 'center', shadow: pal.dark });
    }
    // Yard lines every 5 yards (long every 10), goal lines and end lines.
    ctx.fillStyle = COLORS.line;
    for (let yard = 10; yard <= 110; yard += 5) {
        const x = worldX(yard);
        ctx.globalAlpha = yard % 10 === 0 ? 0.95 : 0.6;
        ctx.fillRect(x - 1, BAND_TOP, yard === 10 || yard === 110 ? 3 : 2, BAND_H);
    }
    ctx.globalAlpha = 1;
    ctx.fillRect(worldX(0) - 1, BAND_TOP, 3, BAND_H);
    ctx.fillRect(worldX(120) - 1, BAND_TOP, 3, BAND_H);
    // Hash marks on every yard, near the third points of the width.
    for (let yard = 11; yard < 110; yard++)
        for (const lane of [FIELD.width / 3, (FIELD.width * 2) / 3]) {
            ctx.globalAlpha = 0.85;
            ctx.fillRect(worldX(yard), screenY(lane) - 1, 1, 3);
        }
    ctx.globalAlpha = 1;
    // Yard numbers: large near the camera side, small on the far side.
    for (let yard = 20; yard <= 100; yard += 10) {
        const label = String(50 - Math.abs(yard - 60));
        drawText(ctx, label, worldX(yard), screenY(FIELD.width - 11), { color: 'rgba(244,246,238,.9)', scale: 3, stretchY: 0.75, align: 'center' });
        drawText(ctx, label, worldX(yard), screenY(7), { color: 'rgba(244,246,238,.55)', scale: 2, stretchY: 0.6, align: 'center' });
    }
    // Sidelines.
    ctx.fillStyle = COLORS.line;
    ctx.fillRect(0, BAND_TOP - 1, STRIP_W, 2);
    ctx.fillRect(0, BAND_TOP + BAND_H - 1, STRIP_W, 3);
    // Foreground apron: warm-up lanes and equipment (static scenery below the near sideline).
    ctx.fillStyle = '#143f20';
    ctx.fillRect(0, BAND_TOP + BAND_H + 2, STRIP_W, H);
    ctx.fillStyle = '#d9d2b0';
    ctx.fillRect(0, BAND_TOP + BAND_H + 16, STRIP_W, 1);
    for (let yard = -MARGIN + 3; yard < FIELD.length + MARGIN; yard += 17) {
        const x = worldX(yard), y = BAND_TOP + BAND_H + 6;
        ctx.fillStyle = COLORS.ink; ctx.fillRect(x - 1, y - 1, 22, 11);
        ctx.fillStyle = (yard / 17 | 0) % 2 ? TEAM_COLORS.home.jersey : TEAM_COLORS.away.jersey; ctx.fillRect(x, y, 20, 9);
        ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x, y, 20, 2);
    }
    turf = c;
    return c;
}

const crowds: HTMLCanvasElement[] = [];
/** The stadium behind the sideline wall: roof, lights, upper and lower decks of fans (two frames) and ad boards. */
export function standsStrip(frame: 0 | 1): HTMLCanvasElement {
    const cached = crowds[frame];
    if (cached) return cached;
    const c = make(STRIP_W, BAND_TOP), ctx = c.getContext('2d')!, rand = rng(99);
    const sky = ctx.createLinearGradient(0, 0, 0, BAND_TOP);
    sky.addColorStop(0, '#0b1030'); sky.addColorStop(0.5, '#1a2150'); sky.addColorStop(1, '#232b63');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, STRIP_W, BAND_TOP);
    // stadium lights
    for (let x = 40; x < STRIP_W; x += 190) {
        ctx.fillStyle = '#35406f'; ctx.fillRect(x, 6, 2, 30);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = '#fff8d6'; ctx.fillRect(x - 8 + i * 5, 3, 4, 3); }
        ctx.fillStyle = 'rgba(255,248,214,.08)'; ctx.fillRect(x - 12, 6, 28, 40);
    }
    const crowdColors = ['#e0455a', '#f6c445', '#7bd0ff', '#fff', '#8f6bff', '#2c6fe4', '#f08a1f', '#41d17a'];
    const rows = [{ y: 30, h: 24, step: 4 }, { y: 62, h: 28, step: 4 }];
    for (const r of rows) {
        ctx.fillStyle = '#12173a'; ctx.fillRect(0, r.y, STRIP_W, r.h);
        for (let row = 0; row < r.h / r.step; row++)
            for (let x = (row & 1) * 2; x < STRIP_W; x += 4) {
                const bob = (frame + x / 4 + row) % 2 === 0 ? 0 : -1;
                ctx.fillStyle = crowdColors[Math.floor(rand() * crowdColors.length)]!;
                ctx.fillRect(x, r.y + row * r.step + 1 + bob, 3, 2);
                ctx.fillStyle = '#f1c9a0';
                ctx.fillRect(x, r.y + row * r.step - 1 + bob, 2, 2);
            }
        ctx.fillStyle = COLORS.wallTrim; ctx.fillRect(0, r.y + r.h, STRIP_W, 2);
    }
    // Ad boards along the wall with team banners and sponsors (invented).
    ctx.fillStyle = COLORS.wall; ctx.fillRect(0, 94, STRIP_W, BAND_TOP - 94);
    const ads = ['WENTZ', 'SUPER BOWL BOUND', 'ARCADE', 'GRIDIRON', 'TURBO', 'FOXES', 'BLUEBIRDS'];
    for (let i = 0, x = 4; x < STRIP_W; i++) {
        const text = ads[i % ads.length]!, w = text.length * 8 + 10;
        const hue = [TEAM_COLORS.home.jersey, '#c0392b', TEAM_COLORS.away.jersey, '#7a35c8', '#1d9a6c'][i % 5]!;
        ctx.fillStyle = hue; ctx.fillRect(x, 97, w, 15);
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(x, 97, w, 3);
        drawText(ctx, text, x + w / 2, 102, { color: '#ffffff', scale: 2, align: 'center', shadow: 'rgba(0,0,0,.5)' });
        x += w + 4;
    }
    ctx.fillStyle = COLORS.wallTrim; ctx.fillRect(0, BAND_TOP - 4, STRIP_W, 2);
    ctx.fillStyle = COLORS.ink; ctx.fillRect(0, BAND_TOP - 2, STRIP_W, 2);
    crowds[frame] = c;
    return c;
}
