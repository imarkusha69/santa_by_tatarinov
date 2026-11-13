// Сжатие фото на клиенте до загрузки: WebP (или JPEG, если браузер не умеет кодировать WebP).

import { api, uploadBlob, ApiError } from "./api";

const MAX_INPUT = 25 * 1024 * 1024;

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob(r, type, q));
}

async function render(src: CanvasImageSource & { width: number; height: number }, maxSide: number, square: boolean) {
  let sx = 0,
    sy = 0,
    sw = src.width,
    sh = src.height;
  if (square) {
    const side = Math.min(sw, sh);
    sx = (sw - side) / 2;
    sy = (sh - side) / 2;
    sw = sh = side;
  }
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
  let blob = await toBlob(canvas, "image/webp", 0.82);
  if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", 0.85);
  if (!blob) throw new ApiError("upload");
  return blob;
}

function checkFile(file: File) {
  if (!file.type.startsWith("image/") || file.size > MAX_INPUT) throw new ApiError("upload");
}

/** Фото желания: две версии, 480 px для ленты и 1280 px для страницы. Возвращает базовый путь. */
export async function uploadWishPhoto(file: File): Promise<string> {
  checkFile(file);
  const img = await decode(file);
  const [small, large] = await Promise.all([render(img, 480, false), render(img, 1280, false)]);
  const { items } = await api<{ items: { base: string; urls: Record<string, string> }[] }>("uploadUrls", {
    kind: "wish",
    count: 1,
  });
  const it = items[0];
  await Promise.all([uploadBlob(it.urls["480"], small), uploadBlob(it.urls["1280"], large)]);
  return it.base;
}

/** Аватар: квадрат 320 px. Возвращает путь в хранилище. */
export async function uploadAvatar(file: File): Promise<string> {
  checkFile(file);
  const img = await decode(file);
  const blob = await render(img, 320, true);
  const { items } = await api<{ items: { base: string; urls: Record<string, string> }[] }>("uploadUrls", {
    kind: "avatar",
  });
  await uploadBlob(items[0].urls["320"], blob);
  return items[0].base;
}
