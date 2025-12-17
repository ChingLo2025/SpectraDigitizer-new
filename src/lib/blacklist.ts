import type { Line, Point } from "../types";

function normalize(v: { x: number; y: number }) {
  const n = Math.hypot(v.x, v.y);
  if (n < 1e-9) return { x: 1, y: 0 };
  return { x: v.x / n, y: v.y / n };
}

function distancePointToLine(p: Point, line: Line): number {
  const v = normalize(line.v);
  const dx = p.x - line.p.x;
  const dy = p.y - line.p.y;
  // |(p-line.p) x v| since v is unit
  return Math.abs(dx * v.y - dy * v.x);
}

function dist2(a: Point, b: Point) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function buildBlacklist(args: {
  xAxisLine: Line;
  yAxisLine: Line;
  tickPointsX: Point[];
  tickPointsY: Point[];
  axisBand: number;
  tickRadius: number;
}): (p: Point) => boolean {
  const { xAxisLine, yAxisLine, tickPointsX, tickPointsY, axisBand, tickRadius } = args;
  const ticks = [...tickPointsX, ...tickPointsY];
  const tickR2 = tickRadius * tickRadius;

  return (p: Point) => {
    if (distancePointToLine(p, xAxisLine) < axisBand) return true;
    if (distancePointToLine(p, yAxisLine) < axisBand) return true;

    // lightweight tick blacklist
    for (const t of ticks) {
      if (dist2(p, t) < tickR2) return true;
    }
    return false;
  };
}
