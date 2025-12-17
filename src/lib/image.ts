export async function loadImageBitmap(file: File): Promise<ImageBitmap> {
  const ok =
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.name.toLowerCase().endsWith(".png") ||
    file.name.toLowerCase().endsWith(".jpg") ||
    file.name.toLowerCase().endsWith(".jpeg");

  if (!ok) throw new Error("Only JPG/PNG is supported.");
  return await createImageBitmap(file);
}

type Rect = { x: number; y: number; w: number; h: number };

export function cropImageData(bitmap: ImageBitmap, rect: Rect): ImageData {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.floor(rect.w));
  const h = Math.max(1, Math.floor(rect.h));

  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(w, h)
      : (document.createElement("canvas") as HTMLCanvasElement);

  // @ts-expect-error OffscreenCanvas vs HTMLCanvasElement
  canvas.width = w;
  // @ts-expect-error OffscreenCanvas vs HTMLCanvasElement
  canvas.height = h;

  // @ts-expect-error OffscreenCanvasRenderingContext2D exists in modern browsers
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas 2D not available.");

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
