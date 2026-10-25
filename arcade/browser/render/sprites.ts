/**
 * Procedural 16-bit style football players. Every frame is built from a pose (joint offsets) and a team palette, drawn once into a
 * small offscreen canvas, outlined and cached; the renderer only picks `(look, animation, frame)`. Art is original.
 * Sprites face right; the renderer mirrors them for left-facing players.
 */
import type { TeamId } from '../../core/simulation';

export type Anim = 'stance' | 'idle' | 'run' | 'throw' | 'catch' | 'block' | 'tackle' | 'fall' | 'celebrate' | 'kick';
type Pair = readonly [number, number];
/** Joint offsets in sprite pixels. Feet are relative to the hip; hands are relative to the shoulder. */
export interface Pose {
    readonly bob?: number;
    readonly lean?: number;
    readonly crouch?: number;
    readonly nearFoot: Pair;
    readonly farFoot: Pair;
    readonly nearHand: Pair;
    readonly farHand: Pair;
    /** Rotate the finished frame a quarter turn: a player lying on the turf. */
    readonly prone?: boolean;
}
export interface AnimDef {
    readonly poses: readonly Pose[];
    /** Frames per second for timed animations (run is driven by distance instead). */
    readonly fps: number;
    readonly loop: boolean;
}
const stand = (a: number): Pose => ({ bob: a, nearFoot: [2, 0], farFoot: [-2, 0], nearHand: [1, 7 - a], farHand: [-1, 7 - a] });
export const ANIMS: Record<Anim, AnimDef> = {
    stance: { fps: 1, loop: true, poses: [{ lean: 6, crouch: 6, nearFoot: [3, 0], farFoot: [-3, 0], nearHand: [5, 9], farHand: [-2, 4] }] },
    idle: { fps: 2, loop: true, poses: [stand(0), { ...stand(1), nearHand: [1, 6], farHand: [-1, 6] }] },
    run: {
        fps: 10, loop: true, poses: [
            { lean: 2, nearFoot: [5, 0], farFoot: [-5, 0], nearHand: [-4, 5], farHand: [4, 4] },
            { lean: 2, bob: 1, nearFoot: [1, 0], farFoot: [-1, -4], nearHand: [-1, 6], farHand: [1, 6] },
            { lean: 2, nearFoot: [-5, 0], farFoot: [5, 0], nearHand: [4, 4], farHand: [-4, 5] },
            { lean: 2, bob: 1, nearFoot: [-1, -4], farFoot: [1, 0], nearHand: [1, 6], farHand: [-1, 6] },
        ],
    },
    throw: {
        fps: 9, loop: false, poses: [
            { lean: -1, nearFoot: [3, 0], farFoot: [-3, 0], nearHand: [-4, -7], farHand: [5, -1] },
            { lean: 2, nearFoot: [4, 0], farFoot: [-3, 0], nearHand: [6, -6], farHand: [-3, 3] },
            { lean: 3, crouch: 1, nearFoot: [5, 0], farFoot: [-4, 0], nearHand: [5, 5], farHand: [-2, 5] },
        ],
    },
    catch: {
        fps: 8, loop: false, poses: [
            { bob: -2, lean: 1, nearFoot: [2, -3], farFoot: [-3, -2], nearHand: [6, -9], farHand: [5, -10] },
            { lean: 1, nearFoot: [3, 0], farFoot: [-3, 0], nearHand: [4, 2], farHand: [3, 3] },
        ],
    },
    block: {
        fps: 6, loop: true, poses: [
            { lean: 3, crouch: 2, nearFoot: [5, 0], farFoot: [-5, 0], nearHand: [6, -1], farHand: [5, 0] },
            { lean: 4, crouch: 2, nearFoot: [6, 0], farFoot: [-4, 0], nearHand: [7, -2], farHand: [6, -1] },
        ],
    },
    tackle: {
        fps: 8, loop: false, poses: [
            { lean: 5, crouch: 4, nearFoot: [-4, 0], farFoot: [-8, 0], nearHand: [8, 6], farHand: [7, 3] },
            { lean: 6, crouch: 6, nearFoot: [-6, -1], farFoot: [-10, 0], nearHand: [9, 8], farHand: [8, 6] },
        ],
    },
    fall: {
        fps: 7, loop: false, poses: [
            { lean: 4, crouch: 3, nearFoot: [-3, -2], farFoot: [-6, 0], nearHand: [7, 3], farHand: [5, 5] },
            { prone: true, lean: 0, nearFoot: [2, 0], farFoot: [-2, 0], nearHand: [2, 5], farHand: [-1, 6] },
        ],
    },
    celebrate: {
        fps: 5, loop: true, poses: [
            { bob: 0, nearFoot: [3, 0], farFoot: [-3, 0], nearHand: [4, -10], farHand: [-4, -10] },
            { bob: -3, nearFoot: [2, -3], farFoot: [-2, -3], nearHand: [5, -9], farHand: [-5, -9] },
        ],
    },
    kick: {
        fps: 8, loop: false, poses: [
            { lean: 0, nearFoot: [-5, 0], farFoot: [2, 0], nearHand: [3, 5], farHand: [-3, 4] },
            { lean: -1, nearFoot: [9, -5], farFoot: [-1, 0], nearHand: [-4, 3], farHand: [4, 3] },
            { lean: -2, nearFoot: [7, -9], farFoot: [-1, 0], nearHand: [-5, 2], farHand: [5, 1] },
        ],
    },
};
/** Sprites are drawn on a 1.15x version of the original 24x32 design grid: chunkier, more detailed 16-bit athletes. */
export const SCALE = 1.15;
export const FRAME_W = Math.round(24 * SCALE), FRAME_H = Math.round(32 * SCALE), ANCHOR_X = Math.round(12 * SCALE), ANCHOR_Y = Math.round(30 * SCALE);
export interface Look {
    readonly team: TeamId;
    readonly number: number;
    /** 0-2: skin tone, so a roster is not 22 clones. */
    readonly skin: number;
}
type Tones = readonly [string, string, string];
const SKIN: readonly Tones[] = [['#b57c52', '#e0a878', '#f6d2ac'], ['#8a5632', '#c98d5f', '#e8b488'], ['#5a3320', '#7d4e32', '#a06a48']];
const TEAM: Record<TeamId, Record<'jersey' | 'helmet' | 'pants' | 'sock', Tones>> = {
    home: { jersey: ['#173f9c', '#2c6fe4', '#6aa5ff'], helmet: ['#16377f', '#2457c8', '#86b0ff'], pants: ['#9c9684', '#e9e6d6', '#ffffff'], sock: ['#173f9c', '#2c6fe4', '#6aa5ff'] },
    away: { jersey: ['#a84e08', '#f08a1f', '#ffc070'], helmet: ['#8a4206', '#d97010', '#ffb869'], pants: ['#a89466', '#e6d6a6', '#fff3c8'], sock: ['#a84e08', '#f08a1f', '#ffc070'] },
};
export const TEAM_COLORS = {
    home: { jersey: '#2c6fe4', light: '#6aa5ff', dark: '#173f9c', helmet: '#2457c8', helmetLight: '#86b0ff', trim: '#ffffff' },
    away: { jersey: '#f08a1f', light: '#ffc070', dark: '#a84e08', helmet: '#d97010', helmetLight: '#ffb869', trim: '#fff2cc' },
} as const;
const COMMON: Record<'mask' | 'shoe' | 'glove' | 'ink', Tones> = { mask: ['#6d7388', '#aab1c4', '#e6e9f2'], shoe: ['#0c0d16', '#242636', '#4f5370'], glove: ['#aab1c4', '#f2f4fa', '#ffffff'], ink: ['#0c0d16', '#10121f', '#10121f'] };
type Mat = 'jersey' | 'helmet' | 'pants' | 'sock' | 'skin' | 'mask' | 'shoe' | 'glove' | 'ink';
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];
/** Light comes from the upper left: a surface facing it takes the light tone, one facing away the shadow tone. */
const LIGHT = [-0.55, -0.83] as const;

export interface Frame {
    readonly canvas: HTMLCanvasElement;
    /** Where the player's feet touch the turf inside the canvas. */
    readonly ax: number;
    readonly ay: number;
}
const cache = new Map<string, Frame>();
const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
interface Cell { readonly mat: Mat; readonly tone: 0 | 1 | 2 }

/**
 * Builds one frame from soft shapes (tapered limbs, ellipses) shaded in three tones by surface direction, then inks an outline
 * whose colour is a dark version of the neighbouring material instead of flat black, which gives it the hand-drawn feel.
 */
function drawPose(look: Look, pose: Pose): HTMLCanvasElement {
    const k = SCALE, W = FRAME_W, H = FRAME_H, buf: (Cell | null)[] = new Array(W * H).fill(null);
    const team = TEAM[look.team], skin = SKIN[look.skin % SKIN.length]!;
    const tones = (m: Mat): Tones => m === 'skin' ? skin : m === 'mask' || m === 'shoe' || m === 'glove' || m === 'ink' ? COMMON[m] : team[m];
    const put = (x: number, y: number, mat: Mat, tone: 0 | 1 | 2) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = { mat, tone }; };
    const shade = (nx: number, ny: number, bias: number): 0 | 1 | 2 => { const d = nx * LIGHT[0] + ny * LIGHT[1] + bias; return d > 0.32 ? 2 : d < -0.28 ? 0 : 1; };
    const capsule = (x0: number, y0: number, x1: number, y1: number, r0: number, r1: number, mat: Mat, bias = 0) => {
        x0 *= k; y0 *= k; x1 *= k; y1 *= k; r0 *= k; r1 *= k;
        const rm = Math.max(r0, r1);
        for (let y = Math.floor(Math.min(y0, y1) - rm); y <= Math.ceil(Math.max(y0, y1) + rm); y++)
            for (let x = Math.floor(Math.min(x0, x1) - rm); x <= Math.ceil(Math.max(x0, x1) + rm); x++) {
                const px = x + 0.5, py = y + 0.5, dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
                const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
                const ox = px - (x0 + dx * t), oy = py - (y0 + dy * t), r = r0 + (r1 - r0) * t;
                if (Math.hypot(ox, oy) <= r) put(x, y, mat, shade(ox / (r || 1), oy / (r || 1), bias));
            }
    };
    const ell = (cx: number, cy: number, rx: number, ry: number, mat: Mat, bias = 0) => {
        cx *= k; cy *= k; rx *= k; ry *= k;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
            for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
                const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
                if (nx * nx + ny * ny <= 1) put(x, y, mat, shade(nx, ny, bias));
            }
    };
    const dot = (x: number, y: number, mat: Mat, tone: 0 | 1 | 2 = 1) => put(Math.round(x * k), Math.round(y * k), mat, tone);
    const bob = pose.bob ?? 0, lean = pose.lean ?? 0, crouch = pose.crouch ?? 0;
    const fy = 30, hipY = fy - 9 - crouch + (bob < 0 ? bob : 0), cx = 12 + lean * 0.4;
    const top = hipY - 9 + (bob > 0 ? 1 : 0), sx = 12 + lean, sy = top + 3;
    const arm = (hand: Pair, far: boolean) => {
        const hx = sx + hand[0], hy = sy + hand[1], ex = sx + hand[0] * 0.5, ey = sy + hand[1] * 0.5 + 0.8;
        capsule(sx, sy, ex, ey, 1.9, 1.6, 'jersey', far ? -0.5 : 0);
        capsule(ex, ey, hx, hy, 1.4, 1.2, 'skin', far ? -0.5 : 0);
        ell(hx, hy, 1.4, 1.3, 'glove', far ? -0.4 : 0);
    };
    const leg = (hx: number, foot: Pair, far: boolean) => {
        const fx = hx + foot[0], fyy = hipY + 9 + foot[1] - 1, kx = hx + foot[0] * 0.45 + 1.2, ky = hipY + 4.5, b = far ? -0.45 : 0;
        capsule(hx, hipY, kx, ky, 2.4, 2.0, 'pants', b);
        capsule(kx, ky, fx, fyy - 2.4, 2.0, 1.6, 'pants', b);
        capsule(fx, fyy - 3.2, fx, fyy - 1.6, 1.7, 1.7, 'sock', b);
        ell(fx + 1.2, fyy + 0.2, 3.0, 1.5, 'shoe', b);
    };
    arm(pose.farHand, true);
    leg(cx - 1.2, pose.farFoot, true);
    // torso: broad shoulders tapering to the waist, pads on top, belt
    capsule(sx - 0.2, top + 3.5, cx + 0.2, hipY - 1, 4.6, 3.3, 'jersey');
    ell(sx - 0.3, top + 2.6, 5.6, 2.9, 'jersey', 0.15);
    ell(sx + 0.2, top + 1.6, 4.4, 1.3, 'jersey', 0.5);
    capsule(cx - 3, hipY - 0.6, cx + 3, hipY - 0.6, 1.5, 1.5, 'pants');
    leg(cx + 1.2, pose.nearFoot, false);
    // jersey number: white with a one-pixel shadow so it reads on either side of the shading
    const digits = String(look.number % 100).split('').map(Number), nx0 = Math.round((sx - (digits.length * 4 - 1) / 2 * 0.9) * k), ny0 = Math.round((top + 3.6) * k);
    for (const [ox, oy, white] of [[1, 1, false], [0, 0, true]] as const)
        digits.forEach((digit, at) => {
            const glyph = DIGITS[digit]!;
            for (let i = 0; i < 15; i++)
                if (glyph[i] === '1')
                    put(nx0 + at * 4 + (i % 3) + ox, ny0 + Math.floor(i / 3) + oy, white ? 'glove' : 'jersey', white ? 2 : 0);
        });
    ell(sx - 4.2, top + 3.2, 0.8, 1.6, 'glove', 1);
    // head: round helmet, face opening, three mask bars, ear hole, stripe, chin strap
    const hx = sx + 0.6, hy = top - 4.2;
    capsule(sx, top + 0.2, sx, top - 1.4, 1.5, 1.3, 'skin', -0.3);
    ell(hx, hy, 4.7, 4.3, 'helmet');
    ell(hx + 2.6, hy + 1.3, 2.3, 2.1, 'skin', 0.1);
    for (let i = 0; i < 3; i++) capsule(hx + 1.2 + i * 0.1, hy + 0.5 + i * 1.3, hx + 5.2, hy + 0.5 + i * 1.3, 0.45, 0.45, 'mask', 0.4);
    capsule(hx + 5.0, hy - 0.4, hx + 4.6, hy + 4.4, 0.55, 0.55, 'mask', 0.2);
    capsule(hx + 0.8, hy + 4.2, hx + 4.4, hy + 4.4, 0.5, 0.5, 'mask', 0);
    dot(hx + 3.2, hy + 0.9, 'ink'); dot(hx - 1.2, hy + 1.6, 'ink');
    capsule(hx - 3.2, hy - 1.7, hx + 3.2, hy - 2.3, 0.55, 0.55, 'glove', 2);
    capsule(hx - 3.4, hy + 2.6, hx - 0.2, hy + 4.2, 0.5, 0.5, 'glove', 1);
    arm(pose.nearHand, false);
    // composite and ink
    const out = make(W, H), o = out.getContext('2d')!;
    const inkOf = (c: string) => { const n = parseInt(c.slice(1), 16); return `rgb(${Math.round(((n >> 16) & 255) * 0.45)},${Math.round(((n >> 8) & 255) * 0.45)},${Math.round((n & 255) * 0.45)})`; };
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
            const cell = buf[y * W + x];
            if (cell) { o.fillStyle = tones(cell.mat)[cell.tone]; o.fillRect(x, y, 1, 1); continue; }
            const near = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).map(([dx, dy]) => (x + dx >= 0 && y + dy >= 0 && x + dx < W && y + dy < H ? buf[(y + dy) * W + x + dx] : null)).find(Boolean);
            if (near) { o.fillStyle = inkOf(tones(near.mat)[0]); o.fillRect(x, y, 1, 1); }
        }
    return out;
}
function prone(upright: HTMLCanvasElement): Frame {
    const c = make(FRAME_H, FRAME_W), ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(3, Math.round(FRAME_W / 2));
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(upright, -ANCHOR_X, -ANCHOR_Y);
    return { canvas: c, ax: 3, ay: Math.round(FRAME_W / 2) + 6 };
}
export function frameFor(look: Look, anim: Anim, index: number): Frame {
    const poses = ANIMS[anim].poses, i = Math.max(0, Math.min(poses.length - 1, Math.floor(index)));
    const key = `${look.team}|${look.skin}|${look.number}|${anim}|${i}`;
    let frame = cache.get(key);
    if (!frame) {
        const pose = poses[i]!;
        const upright = drawPose(look, { ...pose, prone: false });
        frame = pose.prone ? prone(upright) : { canvas: upright, ax: ANCHOR_X, ay: ANCHOR_Y };
        cache.set(key, frame);
    }
    return frame;
}
export const frameCount = (anim: Anim): number => ANIMS[anim].poses.length;
/** Which frame an animation shows after `seconds` (looping ones wrap, one-shots hold their last frame). */
export function frameIndex(anim: Anim, seconds: number): number {
    const def = ANIMS[anim], n = def.poses.length, raw = Math.floor(Math.max(0, seconds) * def.fps);
    return def.loop ? raw % n : Math.min(n - 1, raw);
}
export function drawSprite(ctx: CanvasRenderingContext2D, frame: Frame, x: number, y: number, facingLeft: boolean, lift = 0): void {
    const px = Math.round(x), py = Math.round(y - lift);
    if (facingLeft) {
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(-1, 1);
        ctx.drawImage(frame.canvas, -frame.ax, -frame.ay);
        ctx.restore();
    }
    else
        ctx.drawImage(frame.canvas, px - frame.ax, py - frame.ay);
}
