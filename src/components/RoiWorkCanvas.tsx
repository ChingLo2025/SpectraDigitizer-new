import React, { useEffect, useMemo, useRef } from "react";
import type { Rect, Point, Line } from "../types";

type AxisMode = "x" | "y";
type InteractionMode = "axis" | "calibration" | "curve";
type CalibStage = "X1" | "X2" | "Y1" | "Y2" | "done";

type Props = {
  roi?: ImageData;

  axisRoiX?: Rect;
  axisRoiY?: Rect;

  axisMode: AxisMode;
  onCommitAxisRoi: (mode: AxisMode, rect: Rect) => void;

  autoDetect?: {
    xAxisLine: Line;
    yAxisLine: Line;
    tickPointsX: Point[];
    tickPointsY: Point[];
  };

  // Step 4
  interactionMode: InteractionMode;
  calibStage: CalibStage;
  calibPoints?: { pxX1?: Point; pxX2?: Point; pxY1?: Point; pxY2?: Point };
  onClickRoiPoint?: (p: Point) => void;

  // Step 5
  seedPoints?: Point[];
};

function rectFromPoints(a: Point, b: Point): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(w - 1, r.x));
  const y = Math.max(0, Math.min(h - 1, r.y));
  const rw = Math.max(1, Math.min(w - x, r.w));
  const rh = Math.max(1, Math.min(h - y, r.h));
  return { x, y, w: rw, h: rh };
}

export default function RoiWorkCanvas({
  roi,
  axisRoiX,
  axisRoiY,
  axisMode,
  onCommitAxisRoi,
  autoDetect,
  interactionMode,
  calibStage,
  calibPoints,
  onClickRoiPoint,
  seedPoints,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const placementRef = useRef<{ ox: number; oy: number; scale: number; iw: number; ih: number }>({
    ox: 0,
    oy: 0,
    scale: 1,
    iw: 0,
    ih: 0,
  });

  const dragRef = useRef<{
    active: boolean;
    start?: Point;
    cur?: Point;
    pointerId?: number;
  }>({ active: false });

  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const statusText = useMemo(() => {
    if (!roi) return "Select Plot ROI first.";
    if (interactionMode === "calibration") return `Pick: ${calibStage}`;
    if (interactionMode === "curve") return `Pick seeds: ${(seedPoints?.length ?? 0)}/3`;
    return axisMode === "x" ? "Drag X-axis ROI" : "Drag Y-axis ROI";
  }, [roi, interactionMode, calibStage, axisMode, seedPoints]);

  function roiToCanvas(p: Point): Point {
    const { ox, oy, scale } = placementRef.current;
    return { x: ox + p.x * scale, y: oy + p.y * scale };
  }

  function canvasToRoi(ev: PointerEvent): Point | null {
    const canvas = canvasRef.current;
    if (!canvas || !roi) return null;

    const rect = canvas.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;

    const { ox, oy, scale, iw, ih } = placementRef.current;
    const rx = (cx - ox) / scale;
    const ry = (cy - oy) / scale;

    if (rx < 0 || ry < 0 || rx > iw || ry > ih) return null;
    return { x: rx, y: ry };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.scale(dpr, dpr);

      if (!roi) {
        ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.fillText("Select Plot ROI on the left first.", 12, 24);
        ctx.restore();
        return;
      }

      // offscreen buffer
      let off = offscreenRef.current;
      if (!off) {
        off = document.createElement("canvas");
        offscreenRef.current = off;
      }
      off.width = roi.width;
      off.height = roi.height;
      const offCtx = off.getContext("2d", { willReadFrequently: true });
      if (!offCtx) return;
      offCtx.putImageData(roi, 0, 0);

      // contain fit
      const scale = Math.min(w / roi.width, h / roi.height);
      const dw = roi.width * scale;
      const dh = roi.height * scale;
      const ox = (w - dw) / 2;
      const oy = (h - dh) / 2;

      placementRef.current = { ox, oy, scale, iw: roi.width, ih: roi.height };

      ctx.drawImage(off, ox, oy, dw, dh);

      // Axis ROIs
      const drawRect = (r: Rect | undefined, stroke: string, fill: string) => {
        if (!r) return;
        const rr = clampRect(r, roi.width, roi.height);
        const p0 = roiToCanvas({ x: rr.x, y: rr.y });
        const p1 = roiToCanvas({ x: rr.x + rr.w, y: rr.y + rr.h });
        const rw = p1.x - p0.x;
        const rh = p1.y - p0.y;

        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = stroke;
        ctx.fillStyle = fill;
        ctx.fillRect(p0.x, p0.y, rw, rh);
        ctx.strokeRect(p0.x, p0.y, rw, rh);
        ctx.restore();
      };

      drawRect(axisRoiX, "rgba(0,255,255,0.95)", "rgba(0,255,255,0.08)");
      drawRect(axisRoiY, "rgba(255,0,255,0.95)", "rgba(255,0,255,0.08)");

      // Dragging rect (only axis mode)
      if (interactionMode === "axis") {
        if (dragRef.current.active && dragRef.current.start && dragRef.current.cur) {
          const r = rectFromPoints(dragRef.current.start, dragRef.current.cur);
          const rr = clampRect(r, roi.width, roi.height);

          const p0 = roiToCanvas({ x: rr.x, y: rr.y });
          const p1 = roiToCanvas({ x: rr.x + rr.w, y: rr.y + rr.h });

          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.lineWidth = 2;
          ctx.strokeStyle = axisMode === "x" ? "rgba(0,255,255,0.95)" : "rgba(255,0,255,0.95)";
          ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
          ctx.restore();
        }
      }

      // Auto detect (axis lines + tick candidates)
      if (autoDetect) {
        const drawLine = (line: Line, stroke: string) => {
          ctx.save();
          ctx.lineWidth = 2;
          ctx.strokeStyle = stroke;
          ctx.setLineDash([10, 6]);

          const pA = line.v.x !== 0 ? { x: 0, y: line.p.y } : { x: line.p.x, y: 0 };
          const pB = line.v.x !== 0 ? { x: roi.width, y: line.p.y } : { x: line.p.x, y: roi.height };

          const cA = roiToCanvas(pA);
          const cB = roiToCanvas(pB);

          ctx.beginPath();
          ctx.moveTo(cA.x, cA.y);
          ctx.lineTo(cB.x, cB.y);
          ctx.stroke();
          ctx.restore();
        };

        const drawPoints = (pts: Point[], fill: string) => {
          ctx.save();
          ctx.fillStyle = fill;
          for (const p of pts) {
            const c = roiToCanvas(p);
            ctx.beginPath();
            ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.restore();
        };

        drawLine(autoDetect.xAxisLine, "rgba(0,255,255,0.9)");
        drawLine(autoDetect.yAxisLine, "rgba(255,0,255,0.9)");
        drawPoints(autoDetect.tickPointsX, "rgba(0,255,255,0.95)");
        drawPoints(autoDetect.tickPointsY, "rgba(255,0,255,0.95)");
      }

      // Calibration selected points
      if (calibPoints) {
        const drawPick = (p: Point | undefined, label: string) => {
          if (!p) return;
          const c = roiToCanvas(p);
          ctx.save();
          ctx.fillStyle = "rgba(255,255,0,0.95)";
          ctx.strokeStyle = "rgba(0,0,0,0.75)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "rgba(0,0,0,0.65)";
          ctx.fillRect(c.x + 8, c.y - 12, 34, 18);
          ctx.fillStyle = "white";
          ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          ctx.fillText(label, c.x + 12, c.y + 2);
          ctx.restore();
        };

        drawPick(calibPoints.pxX1, "X1");
        drawPick(calibPoints.pxX2, "X2");
        drawPick(calibPoints.pxY1, "Y1");
        drawPick(calibPoints.pxY2, "Y2");
      }

      // Seed points (Step 5) — only show seeds, NO mask overlay
      if (seedPoints && seedPoints.length > 0) {
        ctx.save();
        for (let i = 0; i < seedPoints.length; i++) {
          const p = seedPoints[i];
          const c = roiToCanvas(p);
          ctx.fillStyle = "rgba(255,140,0,0.95)";
          ctx.strokeStyle = "rgba(0,0,0,0.75)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "rgba(0,0,0,0.65)";
          ctx.fillRect(c.x + 8, c.y - 12, 30, 18);
          ctx.fillStyle = "white";
          ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          ctx.fillText(`S${i + 1}`, c.x + 12, c.y + 2);
        }
        ctx.restore();
      }

      // border
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

      // hint text
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(10, 10, 220, 28);
      ctx.fillStyle = "white";
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      ctx.fillText(statusText, 16, 29);

      ctx.restore();
    };

    draw();

    const onPointerDown = (e: PointerEvent) => {
      if (!roi) return;
      const p = canvasToRoi(e);
      if (!p) return;

      // click mode: calibration or curve seeds
      if (interactionMode === "calibration" || interactionMode === "curve") {
        onClickRoiPoint?.(p);
        draw();
        return;
      }

      // axis ROI dragging
      dragRef.current.active = true;
      dragRef.current.start = p;
      dragRef.current.cur = p;
      dragRef.current.pointerId = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      draw();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (interactionMode !== "axis") return;
      if (!dragRef.current.active) return;
      if (dragRef.current.pointerId !== e.pointerId) return;
      const p = canvasToRoi(e);
      if (!p) return;
      dragRef.current.cur = p;
      draw();
    };

    const finish = (e: PointerEvent) => {
      if (interactionMode !== "axis") return;
      if (!dragRef.current.active) return;
      if (dragRef.current.pointerId !== e.pointerId) return;

      const start = dragRef.current.start;
      const cur = dragRef.current.cur;

      dragRef.current.active = false;
      dragRef.current.pointerId = undefined;

      if (roi && start && cur) {
        const raw = rectFromPoints(start, cur);
        const clamped = clampRect(raw, roi.width, roi.height);
        if (clamped.w >= 10 && clamped.h >= 10) {
          onCommitAxisRoi(axisMode, clamped);
        }
      }

      draw();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    let raf = 0;
    let lastW = parent.clientWidth;
    let lastH = parent.clientHeight;
    const tick = () => {
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w !== lastW || h !== lastH) {
        lastW = w;
        lastH = h;
        draw();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", finish);
      canvas.removeEventListener("pointercancel", finish);
    };
  }, [
    roi,
    axisRoiX,
    axisRoiY,
    axisMode,
    onCommitAxisRoi,
    autoDetect,
    interactionMode,
    calibStage,
    calibPoints,
    onClickRoiPoint,
    seedPoints,
    statusText,
  ]);

  return <canvas ref={canvasRef} style={{ touchAction: "none" }} />;
}
