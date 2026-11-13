// Обложка желания на клиенте: автоподгрузка со страницы и ручная загрузка.
import { api, ApiError, fnUrl, uploadBlob } from "./api";
import { initData } from "./telegram";
import type { CoverReason, Wish } from "./types";
import { renderCover } from "./image";

/** Те же правила, что на сервере: без схемы — https://. */
export function normalizeUserUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/^(javascript|data|file|mailto|vbscript|blob|about|tel|ftp):/i.test(t)) return t;
  return `https://${t}`;
}

export const COVER_HINT: Record<CoverReason, string> = {
  timeout: "Не удалось взять фото с сайта. Загрузите своё",
  no_image: "Не удалось взять фото с сайта. Загрузите своё",
  not_html: "Не удалось взять фото с сайта. Загрузите своё",
  download_failed: "Не удалось взять фото с сайта. Загрузите своё",
  too_large: "Не удалось взять фото с сайта. Загрузите своё",
  robots_disallowed: "Этот магазин не разрешает брать фото. Загрузите своё",
  blocked_host: "Ссылка не подходит. Проверьте адрес",
  invalid_url: "Ссылка не подходит. Проверьте адрес",
};

export type FetchCoverResult =
  | { status: "ok"; cover_file_url: string; preview_url: string | null }
  | { status: "error"; reason: CoverReason };

/** POST /functions/v1/fetch-cover. Сетевые сбои не бросаются, а сводятся к reason. */
export async function fetchCover(url: string, wishId: string): Promise<FetchCoverResult> {
  let res: Response;
  try {
    res = await fetch(fnUrl("fetch-cover"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-init-data": initData },
      body: JSON.stringify({ url, wishId }),
    });
  } catch {
    return { status: "error", reason: "download_failed" };
  }
  const data = await res.json().catch(() => null);
  if (data?.status === "ok" || (data?.status === "error" && data.reason in COVER_HINT)) return data;
  if (res.status === 429) throw new ApiError("rate_limited");
  return { status: "error", reason: "download_failed" };
}

const ACCEPT_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
const ACCEPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/heic-sequence"]);
export const MAX_MANUAL = 10 * 1024 * 1024;

export interface CoverUrls {
  saved: boolean;
  manualUrl: string | null;
  autoUrl: string | null;
}

/**
 * Ручная обложка: на клиенте обрезка 3:4, 1200 px, WebP 0.85 и загрузка в {wish_id}/manual.webp.
 * Если браузер не умеет прочитать файл (HEIC на Android) или не кодирует WebP — конвертирует сервер.
 */
export async function uploadManualCover(file: File, wishId: string, gameId: string): Promise<CoverUrls> {
  if (!(ACCEPT_TYPES.has(file.type.toLowerCase()) || ACCEPT_EXT.test(file.name))) throw new ApiError("cover_type");
  if (file.size > MAX_MANUAL) throw new ApiError("cover_too_large");

  let webp: Blob | null = null;
  try {
    webp = await renderCover(file, 1200, 0.85);
  } catch {
    webp = null;
  }

  if (webp) {
    const { url } = await api<{ url: string }>("coverUploadUrl", { gameId, wishId });
    await uploadBlob(url, webp, true);
  } else {
    let res: Response;
    try {
      res = await fetch(fnUrl("cover-upload"), {
        method: "POST",
        headers: {
          "content-type": file.type || "application/octet-stream",
          "x-init-data": initData,
          "x-wish-id": wishId,
        },
        body: file,
      });
    } catch {
      throw new ApiError("network");
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || data?.status !== "ok") {
      throw new ApiError(data?.reason === "too_large" ? "cover_too_large" : (data?.reason ?? "upload"));
    }
  }
  return api<CoverUrls>("setCover", { gameId, wishId, source: "manual" });
}

/** Фото для показа: обложка (если есть), затем дополнительные фото. */
export function galleryOf(w: Wish) {
  const cover = w.cover?.url ? [{ base: `cover:${w.id}:${w.cover.source}`, small: w.cover.url, large: w.cover.url }] : [];
  return [...cover, ...w.photos];
}
