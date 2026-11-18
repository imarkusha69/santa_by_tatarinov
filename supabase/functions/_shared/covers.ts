// Хранилище обложек и проверка прав на желание. Общий код для api, fetch-cover и cover-upload.
import { db } from "./db.ts";

export const COVER_BUCKET = "wish-covers";
export const manualPath = (wishId: string) => `${wishId}/manual.webp`;
export const autoPath = (wishId: string) => `${wishId}/auto.webp`;
const SIGNED_TTL = 60 * 60 * 24;

export const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export interface WishAccess {
  /** Желание уже есть в базе (иначе это id нового, ещё не сохранённого желания). */
  exists: boolean;
  row: {
    id: string;
    url: string | null;
    cover_source: "auto" | "manual" | "none";
    member_id: string;
  } | null;
}

/**
 * Писать обложку можно в своё желание или в ещё не созданное (id формы нового желания).
 * Чужое существующее желание — отказ.
 */
export async function wishForWrite(wishId: string, userId: string): Promise<WishAccess | null> {
  const { data } = await db
    .from("wishes")
    .select("id, url, cover_source, member_id, member:members(user_id)")
    .eq("id", wishId)
    .maybeSingle();
  if (!data) return { exists: false, row: null };
  // deno-lint-ignore no-explicit-any
  if ((data as any).member?.user_id !== userId) return null;
  return { exists: true, row: data as WishAccess["row"] };
}

export async function coverFiles(wishId: string): Promise<{ manual: boolean; auto: boolean }> {
  const { data } = await db.storage.from(COVER_BUCKET).list(wishId, { limit: 10 });
  const names = new Set((data ?? []).map((f) => f.name));
  return { manual: names.has("manual.webp"), auto: names.has("auto.webp") };
}

export async function storeCover(path: string, webp: Uint8Array) {
  const { error } = await db.storage.from(COVER_BUCKET).upload(path, webp, {
    contentType: "image/webp",
    upsert: true,
    cacheControl: "3600",
  });
  if (error) throw error;
}

/** Подписанные ссылки на чтение (bucket закрытый). */
export async function signCovers(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(paths.filter((p): p is string => !!p))];
  const map = new Map<string, string>();
  if (!uniq.length) return map;
  const { data } = await db.storage.from(COVER_BUCKET).createSignedUrls(uniq, SIGNED_TTL);
  for (const d of data ?? []) if (d.path && d.signedUrl) map.set(d.path, d.signedUrl);
  return map;
}

export async function removeCovers(wishId: string) {
  await db.storage.from(COVER_BUCKET).remove([manualPath(wishId), autoPath(wishId)]);
}

export async function userIdByTelegram(telegramId: number): Promise<string | null> {
  const { data } = await db.from("users").select("id").eq("telegram_id", telegramId).maybeSingle();
  return data?.id ?? null;
}

export const corsHeaders = {
  "access-control-allow-origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "access-control-allow-headers": "content-type, x-init-data, x-wish-id",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

export const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "content-type": "application/json" } });

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 30;

/** Не больше 30 обращений к чужим сайтам / конвертаций за 10 минут на пользователя. */
export async function rateLimited(userId: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("cover_fetches")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);
  if ((count ?? 0) >= RATE_MAX) return true;
  await db.from("cover_fetches").insert({ user_id: userId });
  return false;
}
