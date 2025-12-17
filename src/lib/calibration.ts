import type { Point } from "../types";

function dot(a: Point, b: Point) { return a.x * b.x + a.y * b.y; }
function sub(a: Point, b: Point): Point { return { x: a.x - b.x, y: a.y - b.y }; }
function norm(a: Point) { return Math.hypot(a.x, a.y); }
function normalize(a: Point): Point {
  const n = norm(a);
  if (n < 1e-9) return { x: 1, y: 0 };
  return { x: a.x / n, y: a.y / n };
}

export function buildPixelToDataMapper(args: {
  pxX1: Point; pxX2: Point; pxY1: Point; pxY2: Point;
  x1: number; x2: number; y1: number; y2: number;
}): (p: Point) => { X: number; Y: number } {
  const { pxX1, pxX2, pxY1, pxY2, x1, x2, y1, y2 } = args;

  const vx = normalize(sub(pxX2, pxX1));
  const vy = normalize(sub(pxY2, pxY1));

  const dx = sub(pxX2, pxX1);
  const dy = sub(pxY2, pxY1);

  const denomX = dot(dx, vx);
  const denomY = dot(dy, vy);

  if (Math.abs(denomX) < 1e-6 || Math.abs(denomY) < 1e-6) {
    throw new Error("Calibration points are degenerate (too close).");
  }

  const sx = (x2 - x1) / denomX;
  const sy = (y2 - y1) / denomY;

  return (p: Point) => {
    const relX = dot(sub(p, pxX1), vx);
    const relY = dot(sub(p, pxY1), vy);
    const X = x1 + sx * relX;
    const Y = y1 + sy * relY;
    return { X, Y };
  };
}
