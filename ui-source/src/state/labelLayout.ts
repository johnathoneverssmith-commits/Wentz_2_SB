/**
 * Where to put a label beside each dot so no two labels, and no label and
 * another team's dot, overlap: the scatter on the draft summary has 32 dots in
 * a narrow band, and a label fixed above every dot printed on top of its
 * neighbours. Each dot tries the places around it in turn and takes the first
 * that is clear; if all are taken it takes the least bad (the fewest overlaps).
 * Deterministic: dots are placed in the order given.
 */
export interface LabelDot {
  id: string;
  x: number;
  y: number;
  /** the dot's radius */
  r: number;
  /** the label's size */
  w: number;
  h: number;
}

export interface LabelSpot {
  id: string;
  /** text-anchor "middle" position of the label's baseline */
  x: number;
  y: number;
  anchor: "middle" | "start" | "end";
  overlaps: number;
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}
const hit = (a: Box, b: Box): boolean => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export function layoutLabels(dots: LabelDot[]): Map<string, LabelSpot> {
  const out = new Map<string, LabelSpot>();
  const dotBoxes: Box[] = dots.map((d) => ({ l: d.x - d.r, t: d.y - d.r, r: d.x + d.r, b: d.y + d.r }));
  const placed: Box[] = [];
  for (const [i, d] of dots.entries()) {
    const gap = 2;
    // [dx of the label's anchor, baseline y, anchor], and the box that gives
    const tries: { x: number; y: number; anchor: LabelSpot["anchor"]; box: Box }[] = [
      { x: d.x, y: d.y - d.r - gap, anchor: "middle", box: { l: d.x - d.w / 2, t: d.y - d.r - gap - d.h, r: d.x + d.w / 2, b: d.y - d.r - gap } },
      { x: d.x, y: d.y + d.r + gap + d.h, anchor: "middle", box: { l: d.x - d.w / 2, t: d.y + d.r + gap, r: d.x + d.w / 2, b: d.y + d.r + gap + d.h } },
      { x: d.x + d.r + gap, y: d.y + d.h / 2 - 1, anchor: "start", box: { l: d.x + d.r + gap, t: d.y - d.h / 2, r: d.x + d.r + gap + d.w, b: d.y + d.h / 2 } },
      { x: d.x - d.r - gap, y: d.y + d.h / 2 - 1, anchor: "end", box: { l: d.x - d.r - gap - d.w, t: d.y - d.h / 2, r: d.x - d.r - gap, b: d.y + d.h / 2 } },
      { x: d.x + d.r, y: d.y - d.r - gap - d.h / 2, anchor: "start", box: { l: d.x + d.r, t: d.y - d.r - gap - d.h * 1.5, r: d.x + d.r + d.w, b: d.y - d.r - gap - d.h / 2 } },
      { x: d.x - d.r, y: d.y - d.r - gap - d.h / 2, anchor: "end", box: { l: d.x - d.r - d.w, t: d.y - d.r - gap - d.h * 1.5, r: d.x - d.r, b: d.y - d.r - gap - d.h / 2 } },
      { x: d.x + d.r, y: d.y + d.r + gap + d.h * 1.5, anchor: "start", box: { l: d.x + d.r, t: d.y + d.r + gap + d.h / 2, r: d.x + d.r + d.w, b: d.y + d.r + gap + d.h * 1.5 } },
      { x: d.x - d.r, y: d.y + d.r + gap + d.h * 1.5, anchor: "end", box: { l: d.x - d.r - d.w, t: d.y + d.r + gap + d.h / 2, r: d.x - d.r, b: d.y + d.r + gap + d.h * 1.5 } },
    ];
    let best = tries[0]!;
    let bestScore = Infinity;
    for (const t of tries) {
      const score =
        placed.filter((p) => hit(p, t.box)).length + dotBoxes.filter((b, j) => j !== i && hit(b, t.box)).length;
      if (score < bestScore) {
        best = t;
        bestScore = score;
        if (score === 0) break;
      }
    }
    placed.push(best.box);
    out.set(d.id, { id: d.id, x: best.x, y: best.y, anchor: best.anchor, overlaps: bestScore });
  }
  return out;
}
