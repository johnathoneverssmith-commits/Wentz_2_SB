/**
 * Procedural 16-bit style football players. Every frame is built from a pose (joint offsets) and a team palette, drawn once into a
 * small offscreen canvas, outlined and cached; the renderer only picks `(look, animation, frame)`. Art is original.
 * Sprites face right; the renderer mirrors them for left-facing players.
 */
import type { TeamId } from '../../core/simulation';

export type Anim = 'idle' | 'run' | 'throw' | 'catch' | 'block' | 'tackle' | 'fall' | 'celebrate' | 'kick';
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
export const FRAME_W = 24, FRAME_H = 32, ANCHOR_X = 12, ANCHOR_Y = 30;
export interface Look {
    readonly team: TeamId;
    readonly number: number;
    /** 0-2: skin tone, so a roster is not 22 clones. */
    readonly skin: number;
}
const SKIN = ['#f1c9a0', '#c98d5f', '#7d4e32'] as const;
const PALETTE = {
    home: { jersey: '#2c6fe4', light: '#5b97f2', dark: '#1a47a8', pants: '#f2f0e6', pantsDark: '#bdb9a8', helmet: '#2457c8', helmetLight: '#6fa0ff', helmetDark: '#173d94', trim: '#ffffff', number: '#ffffff' },
    away: { jersey: '#f08a1f', light: '#ffb257', dark: '#b4580c', pants: '#ecdcae', pantsDark: '#bfa978', helmet: '#d97010', helmetLight: '#ffb257', helmetDark: '#9a4c06', trim: '#fff2cc', number: '#fff6dc' },
} as const;
export const TEAM_COLORS = PALETTE;
type Palette = { readonly [K in keyof typeof PALETTE.home]: string };
const OUTLINE = '#10121f', MASK = '#c9ced8', SHOE = '#1a1a24';
const DIGITS = ['010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111'];

export interface Frame {
    readonly canvas: HTMLCanvasElement;
    /** Where the player's feet touch the turf inside the canvas. */
    readonly ax: number;
    readonly ay: number;
}
const cache = new Map<string, Frame>();
const make = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function rect(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
}
/** A pixel line of square dots, used for limbs. */
function limb(ctx: CanvasRenderingContext2D, color: string, x0: number, y0: number, x1: number, y1: number, w: number) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++)
        rect(ctx, color, x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, w, w);
}
function leg(ctx: CanvasRenderingContext2D, pal: Palette, hipX: number, hipY: number, foot: Pair, dark: boolean) {
    const fx = hipX + foot[0], fy = hipY + 9 + foot[1] - 1;
    const kx = hipX + foot[0] * 0.45 + 1, ky = hipY + 4;
    limb(ctx, dark ? pal.pantsDark : pal.pants, hipX, hipY, kx, ky, 3);
    limb(ctx, dark ? pal.pantsDark : pal.pants, kx, ky, fx, fy - 1, 3);
    rect(ctx, SHOE, fx - 1, fy, 5, 2);
}
function arm(ctx: CanvasRenderingContext2D, pal: Palette, skin: string, sx: number, sy: number, hand: Pair, dark: boolean) {
    const hx = sx + hand[0], hy = sy + hand[1];
    const ex = sx + hand[0] * 0.5, ey = sy + hand[1] * 0.5;
    limb(ctx, dark ? pal.dark : pal.jersey, sx, sy, ex, ey, 3);
    limb(ctx, skin, ex, ey, hx, hy, 2);
    rect(ctx, pal.trim, hx, hy, 2, 2);
}
function drawPose(look: Look, pose: Pose): HTMLCanvasElement {
    const pal = PALETTE[look.team], skin = SKIN[look.skin % SKIN.length]!;
    const c = make(FRAME_W, FRAME_H), ctx = c.getContext('2d')!;
    const bob = pose.bob ?? 0, lean = pose.lean ?? 0, crouch = pose.crouch ?? 0;
    const cx = ANCHOR_X, hipY = ANCHOR_Y - 9 - crouch + (bob < 0 ? bob : 0);
    const top = hipY - 9 + (bob > 0 ? 1 : 0);
    const sx = cx + lean, sy = top + 3, L = lean;
    arm(ctx, pal, skin, sx, sy, pose.farHand, true);
    leg(ctx, pal, cx - 1, hipY, pose.farFoot, true);
    // shoulder pads, torso, number and belt
    rect(ctx, pal.jersey, cx - 5 + L, top, 11, 3);
    rect(ctx, pal.light, cx - 5 + L, top, 11, 1);
    rect(ctx, pal.dark, cx - 5 + L, top + 2, 1, 1);
    rect(ctx, pal.jersey, cx - 4 + L, top + 3, 8, 5);
    rect(ctx, pal.dark, cx - 4 + L, top + 3, 1, 5);
    rect(ctx, pal.dark, cx + 3 + L, top + 3, 1, 5);
    rect(ctx, pal.trim, cx - 4 + L, top + 8, 8, 1);
    const glyph = DIGITS[(look.number - 1) % 5]!;
    for (let i = 0; i < 15; i++)
        if (glyph[i] === '1')
            rect(ctx, pal.number, cx - 1 + L + (i % 3), top + 3 + Math.floor(i / 3), 1, 1);
    leg(ctx, pal, cx + 1, hipY, pose.nearFoot, false);
    // helmet: team-coloured rounded shell with a white stripe, a face opening with eye, facemask bars and an ear hole
    const hy = top - 7;
    rect(ctx, skin, cx - 1 + L, top - 1, 3, 2);
    rect(ctx, pal.dark, cx - 3 + L, hy, 7, 1);
    rect(ctx, pal.helmet, cx - 4 + L, hy + 1, 9, 5);
    rect(ctx, pal.helmet, cx - 3 + L, hy + 6, 4, 1);
    rect(ctx, pal.helmetLight, cx - 2 + L, hy + 1, 5, 1);
    rect(ctx, pal.trim, cx - 3 + L, hy + 2, 7, 1);
    rect(ctx, pal.helmetDark, cx - 4 + L, hy + 4, 4, 2);
    rect(ctx, skin, cx + 1 + L, hy + 3, 4, 3);
    rect(ctx, '#10121f', cx + 3 + L, hy + 4, 1, 1);
    rect(ctx, MASK, cx + 1 + L, hy + 3, 4, 1);
    rect(ctx, MASK, cx + 4 + L, hy + 3, 1, 4);
    rect(ctx, MASK, cx + 1 + L, hy + 6, 4, 1);
    rect(ctx, pal.dark, cx - 1 + L, hy + 4, 1, 1);
    arm(ctx, pal, skin, sx, sy, pose.nearHand, false);
    return outline(c);
}
/** One-pixel dark outline around every opaque pixel: the 16-bit "sticker" look that keeps sprites readable on any turf. */
function outline(src: HTMLCanvasElement): HTMLCanvasElement {
    const out = make(src.width, src.height), ctx = out.getContext('2d')!;
    const data = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
    const w = src.width, h = src.height, solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data.data[(y * w + x) * 4 + 3]! > 0;
    ctx.fillStyle = OUTLINE;
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
            if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)))
                ctx.fillRect(x, y, 1, 1);
    ctx.drawImage(src, 0, 0);
    return out;
}
function prone(upright: HTMLCanvasElement): Frame {
    const c = make(FRAME_H, FRAME_W), ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.translate(2, 12);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(upright, -ANCHOR_X, -ANCHOR_Y);
    return { canvas: c, ax: 2, ay: 18 };
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
