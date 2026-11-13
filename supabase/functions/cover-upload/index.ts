// POST /functions/v1/cover-upload  (тело — файл; заголовки x-init-data, x-wish-id, content-type)
// Запасной путь ручной обложки, когда браузер не может сам сделать WebP 3:4:
// HEIC на Android, старый Safari без кодирования WebP. Обычно клиент обрезает и сжимает сам.

import { db } from "../_shared/db.ts";
import { verifyInitData } from "../_shared/telegram.ts";
import { CoverError, readLimited } from "../_shared/cover.ts";
import { toCover } from "../_shared/image.ts";
import { corsHeaders, isUuid, json, manualPath, rateLimited, signCovers, storeCover, userIdByTelegram, wishForWrite } from "../_shared/covers.ts";

const MAX_UPLOAD = 10 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/octet-stream", ""]);

function sniff(b: Uint8Array): boolean {
  const s = (i: number, str: string) => [...str].every((c, j) => b[i + j] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && s(1, "PNG")) return true;
  if (s(0, "RIFF") && s(8, "WEBP")) return true;
  // HEIC/HEIF: ....ftyp<brand>
  if (s(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    return ["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand);
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { status: "error", reason: "method_not_allowed" });

  const init = await verifyInitData(req.headers.get("x-init-data") ?? "");
  if (!init) return json(401, { status: "error", reason: "unauthorized" });
  const userId = await userIdByTelegram(init.user.id);
  if (!userId) return json(401, { status: "error", reason: "unauthorized" });

  const wishId = req.headers.get("x-wish-id");
  if (!isUuid(wishId)) return json(400, { status: "error", reason: "bad_request" });
  const access = await wishForWrite(wishId, userId);
  if (!access) return json(403, { status: "error", reason: "forbidden" });
  if (await rateLimited(userId)) return json(429, { status: "error", reason: "rate_limited" });

  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!TYPES.has(type)) return json(415, { status: "error", reason: "unsupported_type" });

  let bytes: Uint8Array;
  try {
    bytes = await readLimited(new Response(req.body, { headers: req.headers }), MAX_UPLOAD, AbortSignal.timeout(30_000));
  } catch (e) {
    const tooLarge = e instanceof CoverError && e.reason === "too_large";
    return json(tooLarge ? 413 : 400, { status: "error", reason: tooLarge ? "too_large" : "bad_request" });
  }
  if (!sniff(bytes)) return json(415, { status: "error", reason: "unsupported_type" });

  let webp: Uint8Array;
  try {
    webp = await toCover(bytes, 1200, 85);
  } catch {
    return json(422, { status: "error", reason: "unreadable" });
  }

  const path = manualPath(wishId);
  await storeCover(path, webp);
  if (access.exists) {
    await db
      .from("wishes")
      .update({ cover_source: "manual", cover_file_url: path, cover_updated_at: new Date().toISOString() })
      .eq("id", wishId);
  }
  const signed = await signCovers([path]);
  return json(200, { status: "ok", cover_file_url: path, preview_url: signed.get(path) ?? null });
});
