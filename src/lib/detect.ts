import type { Rect, Point, Line } from "../types";

function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(w - 1, r.x));
  const y = Math.max(0, Math.min(h - 1, r.y));
  const rw = Math.max(1, Math.min(w - x, r.w));
  const rh = Math.max(1, Math.min(h - y, r.h));
  return { x, y, w: rw, h: rh };
}

function grayAt(data: Uint8ClampedArray, idx: number): number {
  const r = data[idx], g = data[idx + 1], b = data[idx + 2];
  // simple luminance
  return (r * 0.299 + g * 0.587 + b * 0.114) | 0;
}

function otsuThresholdFromRect(img: ImageData, rect: Rect): number {
  const { data, width } = img;
  const hist = new Array<number>(256).fill(0);

  const x0 = rect.x | 0;
  const y0 = rect.y | 0;
  const x1 = (rect.x + rect.w) | 0;
  const y1 = (rect.y + rect.h) | 0;

  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      const g = grayAt(data, idx);
      hist[g]++;
      total++;
    }
  }
  if (total <= 0) return 128;

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = t;
    }
  }
  return threshold;
}

function buildInkFn(img: ImageData, rectForThresh: Rect) {
  const th = otsuThresholdFromRect(img, rectForThresh);
  const { data, width } = img;

  return {
    th,
    isInk: (x: number, y: number) => {
      const idx = (y * width + x) * 4;
      return grayAt(data, idx) < th;
    },
  };
}

function findXAxisY(img: ImageData, roi: Rect, isInk: (x: number, y: number) => boolean): number {
  const { width, height } = img;
  const r = clampRect(roi, width, height);

  let bestY = r.y;
  let best = -1;

  for (let y = r.y; y < r.y + r.h; y++) {
    let s = 0;
    for (let x = r.x; x < r.x + r.w; x++) if (isInk(x, y)) s++;
    if (s > best) {
      best = s;
      bestY = y;
    }
  }
  return bestY;
}

function findYAxisX(img: ImageData, roi: Rect, isInk: (x: number, y: number) => boolean): number {
  const { width, height } = img;
  const r = clampRect(roi, width, height);

  let bestX = r.x;
  let best = -1;

  for (let x = r.x; x < r.x + r.w; x++) {
    let s = 0;
    for (let y = r.y; y < r.y + r.h; y++) if (isInk(x, y)) s++;
    if (s > best) {
      best = s;
      bestX = x;
    }
  }
  return bestX;
}

function cluster1D(values: number[], mergeDist: number): number[] {
  if (values.length === 0) return [];
  const v = [...values].sort((a, b) => a - b);

  const out: number[] = [];
  let start = v[0];
  let sum = v[0];
  let cnt = 1;

  for (let i = 1; i < v.length; i++) {
    if (v[i] - v[i - 1] <= mergeDist) {
      sum += v[i];
      cnt++;
    } else {
      out.push(sum / cnt);
      start = v[i];
      sum = v[i];
      cnt = 1;
    }
  }
  out.push(sum / cnt);
  return out;
}

function detectXTicks(
  img: ImageData,
  roi: Rect,
  axisY: number,
  isInk: (x: number, y: number) => boolean
): Point[] {
  const { width, height } = img;
  const r = clampRect(roi, width, height);

  const candidatesX: number[] = [];
  const minOffset = 3;
  const maxOffset = 14;

  for (let x = r.x; x < r.x + r.w; x++) {
    // must be on/near axis
    if (!isInk(x, axisY)) continue;

    // tick should extend above or below the axis by at least minOffset
    let hasUp = false;
    for (let dy = minOffset; dy <= maxOffset; dy++) {
      const y = axisY - dy;
      if (y >= r.y && y < r.y + r.h && y >= 0 && y < height && isInk(x, y)) {
        hasUp = true;
        break;
      }
    }
    let hasDown = false;
    for (let dy = minOffset; dy <= maxOffset; dy++) {
      const y = axisY + dy;
      if (y >= r.y && y < r.y + r.h && y >= 0 && y < height && isInk(x, y)) {
        hasDown = true;
        break;
      }
    }

    if (hasUp || hasDown) candidatesX.push(x);
  }

  const merged = cluster1D(candidatesX, 4);
  return merged.map((mx) => ({ x: mx, y: axisY }));
}

function detectYTicks(
  img: ImageData,
  roi: Rect,
  axisX: number,
  isInk: (x: number, y: number) => boolean
): Point[] {
  const { width, height } = img;
  const r = clampRect(roi, width, height);

  const candidatesY: number[] = [];
  const minOffset = 3;
  const maxOffset = 14;

  for (let y = r.y; y < r.y + r.h; y++) {
    if (!isInk(axisX, y)) continue;

    let hasLeft = false;
    for (let dx = minOffset; dx <= maxOffset; dx++) {
      const x = axisX - dx;
      if (x >= r.x && x < r.x + r.w && x >= 0 && x < width && isInk(x, y)) {
        hasLeft = true;
        break;
      }
    }
    let hasRight = false;
    for (let dx = minOffset; dx <= maxOffset; dx++) {
      const x = axisX + dx;
      if (x >= r.x && x < r.x + r.w && x >= 0 && x < width && isInk(x, y)) {
        hasRight = true;
        break;
      }
    }

    if (hasLeft || hasRight) candidatesY.push(y);
  }

  const merged = cluster1D(candidatesY, 4);
  return merged.map((my) => ({ x: axisX, y: my }));
}

export function detectAxesAndTicksTwoRois(args: {
  roi: ImageData;
  axisRoiX: Rect;
  axisRoiY: Rect;
}): {
  xAxisLine: Line;
  yAxisLine: Line;
  tickPointsX: Point[];
  tickPointsY: Point[];
} {
  const { roi, axisRoiX, axisRoiY } = args;

  const rX = clampRect(axisRoiX, roi.width, roi.height);
  const rY = clampRect(axisRoiY, roi.width, roi.height);

  // threshold based on union-ish area (simple: use larger rect area)
  const rectForThresh = (rX.w * rX.h >= rY.w * rY.h) ? rX : rY;
  const { isInk } = buildInkFn(roi, rectForThresh);

  const axisY = findXAxisY(roi, rX, isInk);
  const axisX = findYAxisX(roi, rY, isInk);

  const xAxisLine: Line = { p: { x: 0, y: axisY }, v: { x: 1, y: 0 } };
  const yAxisLine: Line = { p: { x: axisX, y: 0 }, v: { x: 0, y: 1 } };

  const tickPointsX = detectXTicks(roi, rX, axisY, isInk);
  const tickPointsY = detectYTicks(roi, rY, axisX, isInk);

  return { xAxisLine, yAxisLine, tickPointsX, tickPointsY };
}
