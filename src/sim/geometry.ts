// Overlap tests for the shapes the original's physics queries use: rotated
// rectangles (enemy squares, the reticle box, explosions) and circles.

export interface Box {
  kind: 'box';
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** radians */
  angle: number;
}

export interface Circle {
  kind: 'circle';
  x: number;
  y: number;
  r: number;
}

export type Shape = Box | Circle;

export const box = (x: number, y: number, w: number, h: number, angle = 0): Box => ({ kind: 'box', x, y, hw: w / 2, hh: h / 2, angle });
export const circle = (x: number, y: number, r: number): Circle => ({ kind: 'circle', x, y, r });

function boxBox(a: Box, b: Box): boolean {
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const ra = a.hw * Math.abs(Math.cos(a.angle) * ax + Math.sin(a.angle) * ay) + a.hh * Math.abs(-Math.sin(a.angle) * ax + Math.cos(a.angle) * ay);
    const rb = b.hw * Math.abs(Math.cos(b.angle) * ax + Math.sin(b.angle) * ay) + b.hh * Math.abs(-Math.sin(b.angle) * ax + Math.cos(b.angle) * ay);
    if (Math.abs(dx * ax + dy * ay) > ra + rb) return false;
  }
  return true;
}

function boxCircle(b: Box, c: Circle): boolean {
  const cos = Math.cos(-b.angle);
  const sin = Math.sin(-b.angle);
  const dx = c.x - b.x;
  const dy = c.y - b.y;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  const px = Math.max(-b.hw, Math.min(b.hw, lx));
  const py = Math.max(-b.hh, Math.min(b.hh, ly));
  return (lx - px) ** 2 + (ly - py) ** 2 <= c.r * c.r;
}

export function overlaps(a: Shape, b: Shape): boolean {
  if (a.kind === 'box') return b.kind === 'box' ? boxBox(a, b) : boxCircle(a, b);
  if (b.kind === 'box') return boxCircle(b, a);
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= (a.r + b.r) ** 2;
}

/** Godot angle_difference(from, to): shortest signed difference in (-PI, PI]. */
export function angleDifference(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return ((2 * d) % (Math.PI * 2)) - d;
}

/** Godot ease(x, curve) for curve > 0. */
export function ease(x: number, curve: number): number {
  x = Math.max(0, Math.min(1, x));
  if (curve < 1) return 1 - Math.pow(1 - x, 1 / curve);
  return Math.pow(x, curve);
}

/** Tween EASE_OUT + TRANS_QUAD. */
export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);
