/** A 3x5 bitmap font drawn with fillRect, so every piece of canvas text shares the game's pixel grid. Original glyph set. */
const GLYPHS: Record<string, string> = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
    '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', ' ': '000000000000000', ':': '000010000010000', '.': '000000000000010', '-': '000000111000000',
    '&': '010101010101011', "'": '010010000000000', '/': '001001010100100', '!': '010010010000010', '+': '000010111010000',
    '·': '000000010000000', ',': '000000000010100', '?': '110001010000010', '>': '100010001010100', '<': '001010100010001',
    '(': '010100100100010', ')': '010001001001010', '%': '101001010100101', '#': '101111101111101',
};
export interface TextStyle {
    readonly color: string;
    /** Whole-number pixel size of one font dot. */
    readonly scale?: number;
    /** Horizontal stretch of each dot (used for squashed turf lettering). */
    readonly stretchY?: number;
    readonly align?: 'left' | 'center' | 'right';
    /** A one-dot drop shadow in this colour. */
    readonly shadow?: string;
}
export const textWidth = (text: string, scale = 1): number => text.length === 0 ? 0 : (text.length * 4 - 1) * scale;
export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStyle): void {
    const scale = style.scale ?? 1, stretch = style.stretchY ?? 1;
    const upper = text.toUpperCase();
    const width = textWidth(upper, scale);
    const left = Math.round(style.align === 'center' ? x - width / 2 : style.align === 'right' ? x - width : x);
    const paint = (dx: number, dy: number, color: string) => {
        ctx.fillStyle = color;
        let cx = left + dx;
        for (const ch of upper) {
            const g = GLYPHS[ch] ?? GLYPHS['?']!;
            for (let i = 0; i < 15; i++)
                if (g[i] === '1')
                    ctx.fillRect(cx + (i % 3) * scale, Math.round(y + dy + Math.floor(i / 3) * scale * stretch), scale, Math.max(1, Math.round(scale * stretch)));
            cx += 4 * scale;
        }
    };
    if (style.shadow)
        paint(scale, scale, style.shadow);
    paint(0, 0, style.color);
}
/** True for every character the font can draw (tests use this to keep HUD strings drawable). */
export const drawable = (text: string): boolean => [...text.toUpperCase()].every(ch => ch in GLYPHS);
