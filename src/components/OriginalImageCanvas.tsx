import React, { useEffect, useMemo, useRef } from "react";
import type { Rect, Point } from "../types";

type Props = {
  bitmap?: ImageBitmap;
  width: number;
  height: number;

  plotRoi?: Rect;
  onPlotRoiCommit?: (rect: Rect) => void;
};

function useResizeObserver<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      sizeRef.current = { w: cr.width, h: cr.height };
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, sizeRef };
}

function rectFromPoints(a: Point, b: Point): Rect {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function clampRectToImage(r: Rect, iw: number, ih: number): Rect {
  const x = Math.max(0, Math.min(iw - 1, r.x));
  const y = Math.max(0, Math.min(ih - 1, r.y));
  const w = Math.max(1, Math.min(iw - x, r.w));
  const h = Math.max(1, Math.min(ih - y, r.h));
  return { x, y, w, h };
}

export default function OriginalImageCanvas({
  bitmap,
  width,
  height,
  plotRoi,
  onPlotRoiCommit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { ref: wrapRef, sizeRef } = useResizeObserver<HTMLDivElement>();

  // for pointer mapping
  const placementRef = useRef<{ ox: number; oy: number; scale: number; iw: number; ih: number }>({
    ox: 0,
    oy: 0,
    scale: 1,
    iw: 0,
    ih: 0,
  });

  const dragRef = useRef<{
    active: boolean;
    startImg?: Point;
    curImg?: Point;
    pointerId?: number;
  }>({ active: false });

  const info = useMemo(() => {
    if (!bitmap || width <= 0 || height <= 0) return null;
    return { width, height };
  }, [bitmap, width, height]);

  function clientToImagePoint(ev: PointerEvent): Point | null {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap) return null;

    const rect = canvas.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;

    const { ox, oy, scale, iw, ih } = placementRef.current;
    const ix = (cx - ox) / scale;
    const iy = (cy - oy) / scale;

    if (ix < 0 || iy < 0 || ix > iw || iy > ih) return null;
    return { x: ix, y: iy };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      ctx.scale(dpr, dpr);

      if (!bitmap) {
        ctx.font = "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.fillText("Upload a JPG/PNG to start.", 12, 24);
        ctx.restore();
        return;
      }

      const iw = bitmap.width;
      const ih = bitmap.height;

      const scale = Math.min(w / iw, h / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const ox = (w - dw) / 2;
      const oy = (h - dh) / 2;

      placementRef.current = { ox, oy, scale, iw, ih };

      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, ox, oy, dw, dh);

      // ROI overlay (existing or dragging)
      const dragging = dragRef.current.active && dragRef.current.startImg && dragRef.current.curImg;
      const roiToDraw = dragging
        ? rectFromPoints(dragRef.current.startImg!, dragRef.current.curImg!)
        : plotRoi;

      if (roiToDraw) {
        const r = clampRectToImage(roiToDraw, iw, ih);

        // convert image coords -> canvas CSS coords
        const rx = ox + r.x * scale;
        const ry = oy + r.y * scale;
        const rw = r.w * scale;
        const rh = r.h * scale;

        ctx.save();
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(0, 255, 255, 0.95)";
        ctx.strokeRect(rx, ry, rw, rh);

        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(0, 255, 255, 0.12)";
        ctx.fillRect(rx, ry, rw, rh);
        ctx.restore();
      }

      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

      ctx.restore();
    };

    draw();

    // pointer events
    const onPointerDown = (e: PointerEvent) => {
      if (!bitmap) return;
      const p = clientToImagePoint(e);
      if (!p) return;

      dragRef.current.active = true;
      dragRef.current.startImg = p;
      dragRef.current.curImg = p;
      dragRef.current.pointerId = e.pointerId;

      canvas.setPointerCapture(e.pointerId);
      draw();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      if (dragRef.current.pointerId !== e.pointerId) return;
      const p = clientToImagePoint(e);
      if (!p) return;

      dragRef.current.curImg = p;
      draw();
    };

    const finish = (e: PointerEvent) => {
      if (!dragRef.current.active) return;
      if (dragRef.current.pointerId !== e.pointerId) return;

      const start = dragRef.current.startImg;
      const cur = dragRef.current.curImg;

      dragRef.current.active = false;
      dragRef.current.pointerId = undefined;

      if (bitmap && start && cur) {
        const raw = rectFromPoints(start, cur);
        const clamped = clampRectToImage(raw, bitmap.width, bitmap.height);

        // simple minimum size to avoid accidental taps
        if (clamped.w >= 10 && clamped.h >= 10) {
          onPlotRoiCommit?.(clamped);
        }
      }

      draw();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);

    // resize redraw loop
    let raf = 0;
    let last = { ...sizeRef.current };
    const tick = () => {
      const cur = sizeRef.current;
      if (cur.w !== last.w || cur.h !== last.h) {
        last = { ...cur };
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
  }, [bitmap, plotRoi, onPlotRoiCommit, sizeRef, wrapRef]);

  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <canvas ref={canvasRef} style={{ touchAction: "none" }} />
      {info && (
        <div
          style={{
            position: "absolute",
            left: 10,
            bottom: 10,
            padding: "4px 8px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.55)",
            color: "white",
            fontSize: 12,
            lineHeight: 1.2,
          }}
        >
          {info.width} × {info.height}
          {plotRoi ? (
            <div style={{ opacity: 0.85 }}>
              ROI: {Math.round(plotRoi.w)}×{Math.round(plotRoi.h)}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
