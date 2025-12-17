import type { Point } from "../types";

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export function computeAverageColor(roi: ImageData, seeds: Point[]) {
  const { data, width, height } = roi;

  let sr = 0, sg = 0, sb = 0;
  for (const s of seeds) {
    const x = clamp(Math.round(s.x), 0, width - 1);
    const y = clamp(Math.round(s.y), 0, height - 1);
    const idx = (y * width + x) * 4;
    sr += data[idx];
    sg += data[idx + 1];
    sb += data[idx + 2];
  }
  const n = Math.max(1, seeds.length);
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
}

function distRgb(r: number, g: number, b: number, c: { r: number; g: number; b: number }) {
  const dr = r - c.r, dg = g - c.g, db = b - c.b;
  return Math.hypot(dr, dg, db);
}

type Run = { ymin: number; ymax: number };

function findRunsInColumn(args: {
  roi: ImageData;
  x: number;
  pickedColor: { r: number; g: number; b: number };
  threshold: number;
  isBlacklistedPixel: (p: Point) => boolean;
}): Run[] {
  const { roi, x, pickedColor, threshold, isBlacklistedPixel } = args;
  const { data, width, height } = roi;

  const runs: Run[] = [];
  let inRun = false;
  let runStart = 0;

  for (let y = 0; y < height; y++) {
    const p = { x, y };
    let ok = true;

    if (isBlacklistedPixel(p)) ok = false;
    if (ok) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (distRgb(r, g, b, pickedColor) >= threshold) ok = false;
    }

    if (ok && !inRun) {
      inRun = true;
      runStart = y;
    } else if (!ok && inRun) {
      inRun = false;
      runs.push({ ymin: runStart, ymax: y - 1 });
    }
  }

  if (inRun) runs.push({ ymin: runStart, ymax: height - 1 });
  return runs;
}

function runRepresentativeY(run: Run, mode: "centerline" | "median"): number {
  const mid = (run.ymin + run.ymax) / 2;
  if (mode === "median") return Math.floor(mid);
  return mid;
}

function chooseInitialY(runs: Run[], seedY: number, mode: "centerline" | "median"): number | null {
  if (runs.length === 0) return null;
  let bestY = runRepresentativeY(runs[0], mode);
  let bestD = Math.abs(bestY - seedY);
  for (const r of runs) {
    const y = runRepresentativeY(r, mode);
    const d = Math.abs(y - seedY);
    if (d < bestD) {
      bestD = d;
      bestY = y;
    }
  }
  return bestY;
}

function chooseNextY(args: {
  runs: Run[];
  yPrev: number;
  yPrev2: number | null;
  mode: "centerline" | "median";
  maxJump: number;
}): number | null {
  const { runs, yPrev, yPrev2, mode, maxJump } = args;
  if (runs.length === 0) return null;

  const yPred = yPrev2 == null ? yPrev : (yPrev + (yPrev - yPrev2));
  let bestY = runRepresentativeY(runs[0], mode);
  let bestD = Math.abs(bestY - yPred);

  for (const r of runs) {
    const y = runRepresentativeY(r, mode);
    const d = Math.abs(y - yPred);
    if (d < bestD) {
      bestD = d;
      bestY = y;
    }
  }

  if (bestD > maxJump) return null;
  return bestY;
}

export function traceCurveWithSeeds(args: {
  roi: ImageData;
  seeds: Point[]; // len 3
  pickedColor: { r: number; g: number; b: number };
  threshold: number;
  mode: "centerline" | "median";
  maxJump: number;
  isBlacklistedPixel: (p: Point) => boolean;
}): Point[] {
  const { roi, seeds, pickedColor, threshold, mode, maxJump, isBlacklistedPixel } = args;
  const W = roi.width;
  const H = roi.height;
  if (W <= 0 || H <= 0) return [];
  if (seeds.length < 3) return [];

  const sortedSeeds = [...seeds].sort((a, b) => a.x - b.x);
  const sMid = sortedSeeds[1];
  const x0 = clamp(Math.round(sMid.x), 0, W - 1);

  // find initial run in x0 column
  const runs0 = findRunsInColumn({ roi, x: x0, pickedColor, threshold, isBlacklistedPixel });
  const y0 = chooseInitialY(runs0, sMid.y, mode);
  if (y0 == null) return [];

  const traceDir = (dir: -1 | 1) => {
    const pts: Point[] = [];
    let x = x0;
    let yPrev = y0;
    let yPrev2: number | null = null;

    while (true) {
      pts.push({ x, y: yPrev });

      const xn = x + dir;
      if (xn < 0 || xn >= W) break;

      const runs = findRunsInColumn({ roi, x: xn, pickedColor, threshold, isBlacklistedPixel });
      const yNext = chooseNextY({ runs, yPrev, yPrev2, mode, maxJump });
      if (yNext == null) break;

      yPrev2 = yPrev;
      yPrev = yNext;
      x = xn;
    }
    return pts;
  };

  const right = traceDir(1);
  const left = traceDir(-1);

  // left includes x0 too; reverse it to increasing-x and drop duplicate start
  const leftInc = left.slice().reverse();
  const merged = leftInc.concat(right.slice(1));

  return merged;
}

export function mapAndSort(
  pointsPx: Point[],
  pixelToData: (p: Point) => { X: number; Y: number },
  reverseX: boolean
): Array<{ X: number; Y: number }> {
  const mapped = pointsPx.map(pixelToData);
  mapped.sort((a, b) => a.X - b.X);
  if (reverseX) mapped.reverse();
  return mapped;
}
