// Telegram: проверка initData и вызовы Bot API.

export const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
export const BOT_USERNAME = Deno.env.get("TELEGRAM_BOT_USERNAME") ?? "";
export const APP_SHORT_NAME = Deno.env.get("TELEGRAM_APP_SHORT_NAME") ?? "app";

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export interface VerifiedInit {
  user: TgUser;
  startParam: string | null;
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Проверка подписи initData по алгоритму Telegram. null, если подпись неверна или данные устарели. */
export async function verifyInitData(initData: string, maxAgeSec = 60 * 60 * 24): Promise<VerifiedInit | null> {
  if (!initData || !BOT_TOKEN) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), BOT_TOKEN);
  const expected = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  try {
    const user = JSON.parse(userRaw) as TgUser;
    if (typeof user.id !== "number") return null;
    return { user, startParam: params.get("start_param") };
  } catch {
    return null;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Ссылка на mini app; с параметром откроется сразу нужная игра. */
export function appLink(startParam?: string): string {
  const base = `https://t.me/${BOT_USERNAME}/${APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

export async function botCall<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.warn(`telegram ${method} failed`, data.description);
      return null;
    }
    return data.result as T;
  } catch (e) {
    console.warn(`telegram ${method} error`, e);
    return null;
  }
}

export interface SentMessage {
  message_id: number;
  chat: { id: number };
}

/** Сообщение с кнопкой «открыть приложение». */
export function sendText(chatId: number, html: string, button?: { text: string; startParam?: string }) {
  return botCall<SentMessage>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(button
      ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: appLink(button.startParam) }]] } }
      : {}),
  });
}

export function randomCode(len = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length]; // 56 символов, смещение пренебрежимо мало
  return out;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
