// POST /functions/v1/fetch-cover  { url, wishId }
// Берёт фото со страницы товара, сохраняет копию 3:4 (800 px, WebP q80) в wish-covers/{wishId}/auto.webp.
// Вызывается при сохранении желания со ссылкой и по кнопке «Обновить фото». Не по расписанию.

import { db } from "../_shared/db.ts";
import { verifyInitData } from "../_shared/telegram.ts";
import { CoverError, findCoverImage, normalizeUserUrl, type CoverReason } from "../_shared/cover.ts";
import { ImageProcessError, toCover } from "../_shared/image.ts";
import {
  autoPath,
  corsHeaders,
  isUuid,
  json,
  rateLimited,
  signCovers,
  storeCover,
  userIdByTelegram,
  wishForWrite,
} from "../_shared/covers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { status: "error", reason: "method_not_allowed" });

  const init = await verifyInitData(req.headers.get("x-init-data") ?? "");
  if (!init) return json(401, { status: "error", reason: "unauthorized" });
  const userId = await userIdByTelegram(init.user.id);
  if (!userId) return json(401, { status: "error", reason: "unauthorized" });

  const body = await req.json().catch(() => ({}));
  const { url, wishId } = body as { url?: unknown; wishId?: unknown };
  if (!isUuid(wishId)) return json(400, { status: "error", reason: "bad_request" });
  if (typeof url !== "string" || !url.trim() || url.length > 2000) return json(200, { status: "error", reason: "invalid_url" });

  const access = await wishForWrite(wishId, userId);
  if (!access) return json(403, { status: "error", reason: "forbidden" });
  if (await rateLimited(userId)) return json(429, { status: "error", reason: "rate_limited" });

  // Строку в БД трогаем, только если ссылка совпадает с сохранённой: иначе это проверка
  // ещё не сохранённой ссылки из формы, и форма передаст результат при сохранении.
  const normalized = normalizeUserUrl(url);
  const rowMatches = access.exists && access.row!.url === normalized;
  const path = autoPath(wishId);

  try {
    const original = await findCoverImage(normalized);
    let webp: Uint8Array;
    try {
      webp = await toCover(original, 800, 80);
    } catch (e) {
      if (e instanceof ImageProcessError) throw new CoverError("download_failed");
      throw e;
    }
    await storeCover(path, webp);
    if (rowMatches) {
      const now = new Date().toISOString();
      await db
        .from("wishes")
        .update({
          cover_auto_url: path,
          cover_error: null,
          cover_updated_at: now,
          ...(access.row!.cover_source !== "manual" ? { cover_source: "auto", cover_file_url: path } : {}),
        })
        .eq("id", wishId);
    }
    const signed = await signCovers([path]);
    return json(200, { status: "ok", cover_file_url: path, preview_url: signed.get(path) ?? null });
  } catch (e) {
    const reason: CoverReason = e instanceof CoverError ? e.reason : "download_failed";
    if (!(e instanceof CoverError)) console.error("fetch-cover", e);
    if (rowMatches) await db.from("wishes").update({ cover_error: reason }).eq("id", wishId);
    return json(200, { status: "error", reason });
  }
});
