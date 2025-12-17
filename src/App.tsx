import React, { useState } from "react";
import OriginalImageCanvas from "./components/OriginalImageCanvas";
import RoiWorkCanvas from "./components/RoiWorkCanvas";
import DataChartCanvas from "./components/DataChartCanvas";

import { initialState, type AppState, type Rect, type Point } from "./types";
import { loadImageBitmap, cropImageData } from "./lib/image";
import { detectAxesAndTicksTwoRois } from "./lib/detect";
import { buildPixelToDataMapper } from "./lib/calibration";
import { buildBlacklist } from "./lib/blacklist";
import { computeAverageColor, traceCurveWithSeeds, mapAndSort } from "./lib/curve";
import { toCsv, downloadText } from "./lib/export";

import "./styles.css";

type AxisMode = "x" | "y";
type InteractionMode = "axis" | "calibration" | "curve";
type CalibStage = "X1" | "X2" | "Y1" | "Y2" | "done";

function dist2(a: Point, b: Point) {
  const dx = a.x - b.x,
    dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function nearestWithin(p: Point, pts: Point[], radius: number): Point | null {
  const r2 = radius * radius;
  let best: Point | null = null;
  let bestD = Infinity;
  for (const q of pts) {
    const d = dist2(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  if (best && bestD <= r2) return best;
  return null;
}

export default function App() {
  const [state, setState] = useState<AppState>({
    ...initialState,
    calibration: { reverseX: false },
    curve: { seeds: [], threshold: 45, mode: "centerline", maxJump: 20 },
  });

  const [error, setError] = useState<string | null>(null);

  const [axisMode, setAxisMode] = useState<AxisMode>("x");
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("axis");
  const [calibStage, setCalibStage] = useState<CalibStage>("X1");

  const hasPlotRoi = !!state.roiImageData;
  const canAutoDetect = !!state.roiImageData && !!state.axisRoiX && !!state.axisRoiY;
  const hasAutoDetect = !!state.autoDetect;

  const calib = state.calibration ?? { reverseX: false };
  const curve = state.curve ?? { seeds: [], threshold: 45, mode: "centerline", maxJump: 20 };

  const canPickCalib = hasAutoDetect;

  const canBuildCalibration =
    !!calib.pxX1 &&
    !!calib.pxX2 &&
    !!calib.pxY1 &&
    !!calib.pxY2 &&
    Number.isFinite(calib.x1) &&
    Number.isFinite(calib.x2) &&
    Number.isFinite(calib.y1) &&
    Number.isFinite(calib.y2);

  const calibrationReady = !!calib.pixelToData;

  const canPickSeeds = calibrationReady && !!state.roiImageData && !!state.autoDetect;
  const seedsReady = curve.seeds.length === 3;

  async function onUpload(file?: File) {
    setError(null);
    if (!file) return;

    try {
      const bitmap = await loadImageBitmap(file);
      if (state.image.bitmap) state.image.bitmap.close();

      setAxisMode("x");
      setInteractionMode("axis");
      setCalibStage("X1");

      setState(() => ({
        image: { file, bitmap, width: bitmap.width, height: bitmap.height },
        plotRoi: undefined,
        roiImageData: undefined,
        axisRoiX: undefined,
        axisRoiY: undefined,
        autoDetect: undefined,
        calibration: { reverseX: false },
        curve: { seeds: [], threshold: 45, mode: "centerline", maxJump: 20 },
      }));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load image.");
    }
  }

  function onPlotRoiCommit(rect: Rect) {
    const bmp = state.image.bitmap;
    if (!bmp) return;

    try {
      const roiImageData = cropImageData(bmp, rect);

      setAxisMode("x");
      setInteractionMode("axis");
      setCalibStage("X1");

      setState((prev) => ({
        ...prev,
        plotRoi: rect,
        roiImageData,
        axisRoiX: undefined,
        axisRoiY: undefined,
        autoDetect: undefined,
        calibration: { reverseX: prev.calibration?.reverseX ?? false },
        curve: {
          seeds: [],
          threshold: prev.curve?.threshold ?? 45,
          mode: prev.curve?.mode ?? "centerline",
          maxJump: prev.curve?.maxJump ?? 20,
        },
      }));
    } catch (e: any) {
      setError(e?.message ?? "Failed to crop ROI.");
    }
  }

  function onCommitAxisRoi(mode: AxisMode, rect: Rect) {
    setState((prev) => ({
      ...prev,
      autoDetect: undefined,
      axisRoiX: mode === "x" ? rect : prev.axisRoiX,
      axisRoiY: mode === "y" ? rect : prev.axisRoiY,
    }));
  }

  function onAutoDetect() {
    if (!state.roiImageData || !state.axisRoiX || !state.axisRoiY) return;
    setError(null);

    try {
      const result = detectAxesAndTicksTwoRois({
        roi: state.roiImageData,
        axisRoiX: state.axisRoiX,
        axisRoiY: state.axisRoiY,
      });

      setCalibStage("X1");
      setInteractionMode("calibration");

      setState((prev) => ({
        ...prev,
        autoDetect: result,
        calibration: {
          reverseX: prev.calibration?.reverseX ?? false,
          x1: prev.calibration?.x1,
          x2: prev.calibration?.x2,
          y1: prev.calibration?.y1,
          y2: prev.calibration?.y2,
        },
        curve: { ...prev.curve!, seeds: [], pickedColor: undefined, points: undefined },
      }));
    } catch (e: any) {
      setError(e?.message ?? "Auto Detect failed.");
    }
  }

  function clearCalibrationPicks() {
    setCalibStage("X1");
    setState((prev) => ({
      ...prev,
      calibration: {
        ...prev.calibration,
        pxX1: undefined,
        pxX2: undefined,
        pxY1: undefined,
        pxY2: undefined,
        pixelToData: undefined,
        isBlacklistedPixel: undefined,
      },
      curve: { ...prev.curve!, seeds: [], pickedColor: undefined, points: undefined },
    }));
  }

  function updateNumber(key: "x1" | "x2" | "y1" | "y2", v: string) {
    const n = v.trim() === "" ? undefined : Number(v);
    setState((prev) => ({
      ...prev,
      calibration: {
        ...prev.calibration,
        [key]: Number.isFinite(n as any) ? (n as number) : undefined,
        pixelToData: undefined,
        isBlacklistedPixel: undefined,
      },
      curve: { ...prev.curve!, points: undefined },
    }));
  }

  function toggleReverseX(v: boolean) {
    setState((prev) => ({
      ...prev,
      calibration: { ...prev.calibration, reverseX: v },
      curve: { ...prev.curve!, points: undefined },
    }));
  }

  function buildCalibration() {
    setError(null);
    if (!canBuildCalibration) return;

    try {
      const c = state.calibration!;
      const mapper = buildPixelToDataMapper({
        pxX1: c.pxX1!,
        pxX2: c.pxX2!,
        pxY1: c.pxY1!,
        pxY2: c.pxY2!,
        x1: c.x1!,
        x2: c.x2!,
        y1: c.y1!,
        y2: c.y2!,
      });

      // build blacklist once we have autoDetect
      let blackFn: ((p: Point) => boolean) | undefined = undefined;
      if (state.autoDetect) {
        blackFn = buildBlacklist({
          xAxisLine: state.autoDetect.xAxisLine,
          yAxisLine: state.autoDetect.yAxisLine,
          tickPointsX: state.autoDetect.tickPointsX,
          tickPointsY: state.autoDetect.tickPointsY,
          axisBand: 4,
          tickRadius: 6,
        });
      }

      setState((prev) => ({
        ...prev,
        calibration: { ...prev.calibration, pixelToData: mapper, isBlacklistedPixel: blackFn },
        curve: { ...prev.curve!, seeds: [], pickedColor: undefined, points: undefined },
      }));
    } catch (e: any) {
      setError(e?.message ?? "Failed to build calibration.");
    }
  }

  // Click handler (Step 4 or Step 5 depending on mode)
  function onClickRoiPoint(p: Point) {
    // Step 5: seeds
    if (interactionMode === "curve") {
      if (!state.roiImageData) return;
      if (!calib.pixelToData) return;
      if (!calib.isBlacklistedPixel) return;

      setState((prev) => {
        const curv = prev.curve!;
        if (curv.seeds.length >= 3) return prev;

        const seeds = [...curv.seeds, p];

        if (seeds.length === 3) {
          const pickedColor = computeAverageColor(prev.roiImageData!, seeds);

          const pxPts = traceCurveWithSeeds({
            roi: prev.roiImageData!,
            seeds,
            pickedColor,
            threshold: curv.threshold,
            mode: curv.mode,
            maxJump: curv.maxJump,
            isBlacklistedPixel: calib.isBlacklistedPixel!,
          });

          const dataPts = mapAndSort(pxPts, calib.pixelToData!, calib.reverseX);

          return { ...prev, curve: { ...curv, seeds, pickedColor, points: dataPts } };
        }

        return { ...prev, curve: { ...curv, seeds, points: undefined } };
      });

      return;
    }

    // Step 4: calibration picking
    if (!state.autoDetect) return;

    const radius = 14;

    if (calibStage === "X1" || calibStage === "X2") {
      const picked = nearestWithin(p, state.autoDetect.tickPointsX, radius);
      if (!picked) return;

      setState((prev) => ({
        ...prev,
        calibration: {
          ...prev.calibration,
          pxX1: calibStage === "X1" ? picked : prev.calibration?.pxX1,
          pxX2: calibStage === "X2" ? picked : prev.calibration?.pxX2,
          pixelToData: undefined,
          isBlacklistedPixel: undefined,
        },
        curve: { ...prev.curve!, points: undefined },
      }));
      setCalibStage(calibStage === "X1" ? "X2" : "Y1");
      return;
    }

    if (calibStage === "Y1" || calibStage === "Y2") {
      const picked = nearestWithin(p, state.autoDetect.tickPointsY, radius);
      if (!picked) return;

      setState((prev) => ({
        ...prev,
        calibration: {
          ...prev.calibration,
          pxY1: calibStage === "Y1" ? picked : prev.calibration?.pxY1,
          pxY2: calibStage === "Y2" ? picked : prev.calibration?.pxY2,
          pixelToData: undefined,
          isBlacklistedPixel: undefined,
        },
        curve: { ...prev.curve!, points: undefined },
      }));
      setCalibStage(calibStage === "Y1" ? "Y2" : "done");
      return;
    }
  }

  function startPickSeeds() {
    if (!canPickSeeds) return;
    setInteractionMode("curve");
    setState((prev) => ({
      ...prev,
      curve: { ...prev.curve!, seeds: [], pickedColor: undefined, points: undefined },
    }));
  }

  function clearSeeds() {
    setState((prev) => ({
      ...prev,
      curve: { ...prev.curve!, seeds: [], pickedColor: undefined, points: undefined },
    }));
  }

  function retraceNow(next?: Partial<AppState["curve"]>) {
    if (!state.roiImageData) return;
    if (!calib.pixelToData) return;
    if (!calib.isBlacklistedPixel) return;

    const curv = { ...curve, ...(next ?? {}) };
    if (curv.seeds.length !== 3 || !curv.pickedColor) return;

    try {
      const pxPts = traceCurveWithSeeds({
        roi: state.roiImageData,
        seeds: curv.seeds,
        pickedColor: curv.pickedColor,
        threshold: curv.threshold,
        mode: curv.mode,
        maxJump: curv.maxJump,
        isBlacklistedPixel: calib.isBlacklistedPixel,
      });

      const dataPts = mapAndSort(pxPts, calib.pixelToData, calib.reverseX);

      setState((prev) => ({
        ...prev,
        curve: { ...prev.curve!, ...curv, points: dataPts },
      }));
    } catch (e: any) {
      setError(e?.message ?? "Trace failed.");
    }
  }

  function setThreshold(v: number) {
    setState((prev) => ({ ...prev, curve: { ...prev.curve!, threshold: v } }));
    retraceNow({ threshold: v });
  }

  function setMode(m: "centerline" | "median") {
    setState((prev) => ({ ...prev, curve: { ...prev.curve!, mode: m } }));
    retraceNow({ mode: m });
  }

  function setMaxJump(v: number) {
    setState((prev) => ({ ...prev, curve: { ...prev.curve!, maxJump: v } }));
    retraceNow({ maxJump: v });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">FTIR Digitizer (MVP)</div>
        <div className="upload">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => onUpload(e.target.files?.[0])}
          />
        </div>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="main">
        <section className="panel">
          <div className="panelTitle">
            Original Image <span className="sub">(drag Plot ROI here)</span>
          </div>
          <div className="panelBody">
            <OriginalImageCanvas
              bitmap={state.image.bitmap}
              width={state.image.width}
              height={state.image.height}
              plotRoi={state.plotRoi}
              onPlotRoiCommit={onPlotRoiCommit}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panelTitle">
            ROI Image <span className="sub">(Axis ROIs → Auto Detect → Calib → Seeds)</span>
          </div>

          <div className="btnRow">
            <button
              className="btn"
              disabled={!hasPlotRoi || interactionMode !== "axis"}
              onClick={() => setAxisMode("x")}
              title="Drag rectangle around x-axis + x ticks area"
            >
              Select X Axis ROI{" "}
              {axisMode === "x" && interactionMode === "axis" ? <span className="pill">active</span> : null}
            </button>

            <button
              className="btn"
              disabled={!hasPlotRoi || interactionMode !== "axis"}
              onClick={() => setAxisMode("y")}
              title="Drag rectangle around y-axis + y ticks area"
            >
              Select Y Axis ROI{" "}
              {axisMode === "y" && interactionMode === "axis" ? <span className="pill">active</span> : null}
            </button>

            <button className="btn" disabled={!canAutoDetect} onClick={onAutoDetect}>
              Auto Detect
            </button>

            <button className="btn" disabled={!canPickCalib} onClick={() => setInteractionMode("calibration")}>
              Pick Calibration
            </button>

            <button className="btn" disabled={!canPickSeeds} onClick={startPickSeeds}>
              Pick Seeds
            </button>

            <button className="btn" disabled={curve.seeds.length === 0} onClick={clearSeeds}>
              Clear Seeds
            </button>

            <button className="btn" onClick={() => setInteractionMode("axis")}>
              Back to Axis ROI
            </button>
          </div>

          <div className="panelBody">
            <RoiWorkCanvas
              roi={state.roiImageData}
              axisRoiX={state.axisRoiX}
              axisRoiY={state.axisRoiY}
              axisMode={axisMode}
              onCommitAxisRoi={onCommitAxisRoi}
              autoDetect={state.autoDetect}
              interactionMode={interactionMode}
              calibStage={calibStage}
              calibPoints={state.calibration}
              onClickRoiPoint={onClickRoiPoint}
              seedPoints={curve.seeds}
            />
          </div>
        </section>
      </div>

      <div className="bottom">
        <section className="panel bottomPanel">
          <div className="panelTitle" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>Data Preview Chart</span>

            <button
              className="btn"
              disabled={!curve.points || curve.points.length === 0}
              onClick={() => {
                const pts = curve.points ?? [];
                const csv = toCsv(pts);
                const base = state.image.file?.name?.replace(/\.[^.]+$/, "") || "ftir_digitized";
                downloadText(`${base}.csv`, csv, "text/csv;charset=utf-8");
              }}
            >
              Download CSV
            </button>
          </div>

          <div className="panelBody" style={{ padding: 0 }}>
            <div style={{ height: "100%", minHeight: 220 }}>
              <DataChartCanvas points={curve.points} />
            </div>
          </div>
        </section>

        <section className="panel controlsPanel">
          <div className="panelTitle">
            Controls {calibrationReady ? <span className="pill">calibrated</span> : null}{" "}
            {curve.points ? <span className="pill">traced</span> : null}
          </div>

          <div className="panelBody" style={{ overflow: "auto" }}>
            <div className="muted" style={{ padding: "10px 12px" }}>
              Step 4: X1→X2→Y1→Y2 → Build Calibration<br />
              Step 5: Pick 3 seeds (S1/S2/S3) → auto trace
            </div>

            {/* Step 4 inputs */}
            <div className="field">
              <label>x1</label>
              <input type="number" value={calib.x1 ?? ""} onChange={(e) => updateNumber("x1", e.target.value)} />
            </div>
            <div className="field">
              <label>x2</label>
              <input type="number" value={calib.x2 ?? ""} onChange={(e) => updateNumber("x2", e.target.value)} />
            </div>
            <div className="field">
              <label>y1</label>
              <input type="number" value={calib.y1 ?? ""} onChange={(e) => updateNumber("y1", e.target.value)} />
            </div>
            <div className="field">
              <label>y2</label>
              <input type="number" value={calib.y2 ?? ""} onChange={(e) => updateNumber("y2", e.target.value)} />
            </div>

            <div className="field">
              <label style={{ width: 80 }}>Reverse X</label>
              <input type="checkbox" checked={!!calib.reverseX} onChange={(e) => toggleReverseX(e.target.checked)} />
              <span className="muted" style={{ opacity: 0.8 }}>sort later</span>
            </div>

            <div className="btnRow">
              <button className="btn" disabled={!canBuildCalibration} onClick={buildCalibration}>
                Build Calibration
              </button>
              <button className="btn" disabled={!hasAutoDetect} onClick={clearCalibrationPicks}>
                Clear Calib Picks
              </button>
            </div>

            {/* Step 5 controls */}
            <div className="muted" style={{ padding: "8px 12px 0 12px" }}>
              Curve extraction (Step 5)
            </div>

            <div className="field">
              <label style={{ width: 80 }}>Threshold</label>
              <input
                type="range"
                min={1}
                max={200}
                value={curve.threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                disabled={!seedsReady}
              />
              <span className="pill">{curve.threshold}</span>
            </div>

            <div className="field">
              <label style={{ width: 80 }}>Mode</label>
              <select value={curve.mode} onChange={(e) => setMode(e.target.value as any)} disabled={!seedsReady}>
                <option value="centerline">centerline</option>
                <option value="median">median</option>
              </select>
            </div>

            <div className="field">
              <label style={{ width: 80 }}>MaxJump</label>
              <input
                type="number"
                value={curve.maxJump}
                onChange={(e) => setMaxJump(Number(e.target.value))}
                disabled={!seedsReady}
              />
            </div>

            <div className="btnRow">
              <button className="btn" disabled={!seedsReady || !curve.pickedColor} onClick={() => retraceNow()}>
                Retrace
              </button>
            </div>

            <div className="muted" style={{ padding: "0 12px 12px 12px" }}>
              Seeds: {curve.seeds.length}/3 {seedsReady ? "✅" : "❌"}<br />
              PickedColor: {curve.pickedColor ? `rgb(${curve.pickedColor.r},${curve.pickedColor.g},${curve.pickedColor.b})` : "—"}<br />
              Points: {curve.points ? curve.points.length : 0}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
