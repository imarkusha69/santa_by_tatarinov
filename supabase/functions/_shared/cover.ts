// Обложка желания со страницы товара.
// Безопасность: только http/https, проверка IP после DNS на каждом шаге (включая редиректы
// и картинку), таймаут 5 с, лимиты размера с потоковым чтением, соблюдение robots.txt.
// Парсим только og:image, twitter:image, link rel=image_src и JSON-LD Product.image.

export type CoverReason =
  | "invalid_url"
  | "blocked_host"
  | "robots_disallowed"
  | "timeout"
  | "not_html"
  | "no_image"
  | "too_large"
  | "download_failed";

export const COVER_REASONS: readonly CoverReason[] = [
  "invalid_url",
  "blocked_host",
  "robots_disallowed",
  "timeout",
  "not_html",
  "no_image",
  "too_large",
  "download_failed",
];

export class CoverError extends Error {
  constructor(public reason: CoverReason) {
    super(reason);
  }
}

export const BOT_TOKEN_UA = "SantaCoverBot";
export const USER_AGENT = `${BOT_TOKEN_UA}/1.0 (+wish cover preview; respects robots.txt)`;

export const TIMEOUT_MS = 5000;
export const MAX_REDIRECTS = 3;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_ROBOTS_BYTES = 512 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ---------------------------------------------------------------------------
// Ссылка пользователя
// ---------------------------------------------------------------------------

/** Как в saveWish: без схемы — дописываем https://. Чужие схемы оставляем, чтобы отклонить. */
export function normalizeUserUrl(raw: string): string {
  const t = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/^(javascript|data|file|mailto|vbscript|blob|about|tel|ftp):/i.test(t)) return t;
  return `https://${t}`;
}

export function parseHttpUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new CoverError("invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new CoverError("invalid_url");
  if (u.username || u.password) throw new CoverError("invalid_url");
  return u;
}

// ---------------------------------------------------------------------------
// Проверка адресов
// ---------------------------------------------------------------------------

function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const a = m.slice(1).map(Number);
  return a.every((x) => x <= 255) ? a : null;
}

function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, "").toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  if (!s.includes(":")) return null;
  // встроенный IPv4 в конце: ::ffff:1.2.3.4
  const v4m = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4m) {
    const v4 = parseIPv4(v4m[1]);
    if (!v4) return null;
    s = s.slice(0, -v4m[1].length) + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

function blockedV4(a: number[]): boolean {
  const [x, y, z] = a;
  return (
    x === 0 || // 0.0.0.0/8
    x === 10 || // 10.0.0.0/8
    x === 127 || // 127.0.0.0/8
    (x === 169 && y === 254) || // 169.254.0.0/16 (в т.ч. метаданные облака)
    (x === 172 && y >= 16 && y <= 31) || // 172.16.0.0/12
    (x === 192 && y === 168) || // 192.168.0.0/16
    (x === 100 && y >= 64 && y <= 127) || // 100.64.0.0/10 CGNAT
    (x === 192 && y === 0 && z === 0) || // 192.0.0.0/24
    (x === 198 && (y === 18 || y === 19)) || // 198.18.0.0/15
    x >= 224 // multicast, зарезервированные, broadcast
  );
}

function blockedV6(g: number[]): boolean {
  const allZeroUntil = (n: number) => g.slice(0, n).every((x) => x === 0);
  const v4From = (hi: number, lo: number) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (allZeroUntil(8)) return true; // ::
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (allZeroUntil(5) && g[5] === 0xffff) return blockedV4(v4From(g[6], g[7])); // ::ffff:a.b.c.d
  if (allZeroUntil(6)) return blockedV4(v4From(g[6], g[7])); // ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedV4(v4From(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return blockedV4(v4From(g[1], g[2])); // 6to4
  return false;
}

/** true — адрес частный, служебный или некорректный. */
export function isBlockedIp(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return blockedV4(v4);
  const v6 = parseIPv6(ip);
  if (v6) return blockedV6(v6);
  return true;
}

export interface NetDeps {
  resolve: (host: string) => Promise<string[]>;
  fetch: typeof fetch;
}

async function dohResolve(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ["A", "AAAA"]) {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json();
    for (const a of data.Answer ?? []) if ((a.type === 1 || a.type === 28) && typeof a.data === "string") out.push(a.data);
  }
  return out;
}

/** DNS: системный резолвер Deno, если он недоступен в рантайме — DNS-over-HTTPS. */
export async function defaultResolve(host: string): Promise<string[]> {
  if (typeof Deno.resolveDns === "function") {
    try {
      const [a, aaaa] = await Promise.all([
        Deno.resolveDns(host, "A").catch(() => [] as string[]),
        Deno.resolveDns(host, "AAAA").catch(() => [] as string[]),
      ]);
      const all = [...a, ...aaaa];
      if (all.length) return all;
    } catch {
      /* перейдём на DoH */
    }
  }
  return dohResolve(host);
}

export const defaultDeps: NetDeps = { resolve: defaultResolve, fetch: (...a) => fetch(...a) };

function withDeadline<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new CoverError("timeout"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new CoverError("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/** Хост должен разрешаться только в публичные адреса. Проверяем IP, а не имя. */
export async function assertPublicHost(url: URL, deps: NetDeps, signal: AbortSignal) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new CoverError("invalid_url");
  if (url.username || url.password) throw new CoverError("invalid_url");
  if (url.port && url.port !== "80" && url.port !== "443") throw new CoverError("blocked_host");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) throw new CoverError("invalid_url");
  if (host === "localhost" || /\.(localhost|local|internal|home\.arpa)$/.test(host)) throw new CoverError("blocked_host");
  if (parseIPv4(host) || parseIPv6(host)) {
    if (isBlockedIp(host)) throw new CoverError("blocked_host");
    return;
  }
  let ips: string[];
  try {
    ips = await withDeadline(deps.resolve(host), signal);
  } catch (e) {
    if (e instanceof CoverError) throw e;
    throw new CoverError("download_failed");
  }
  if (!ips.length) throw new CoverError("download_failed");
  if (ips.some(isBlockedIp)) throw new CoverError("blocked_host");
}

// ---------------------------------------------------------------------------
// Безопасный GET
// ---------------------------------------------------------------------------

function isAbort(e: unknown) {
  return e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
}

/** GET с ручными редиректами (≤3), каждый адрес проверяется заново. */
export async function safeGet(
  start: URL,
  accept: string,
  signal: AbortSignal,
  deps: NetDeps,
): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; ; hop++) {
    await assertPublicHost(url, deps, signal);
    let res: Response;
    try {
      res = await deps.fetch(url, {
        redirect: "manual",
        signal,
        headers: { "user-agent": USER_AGENT, accept, "accept-language": "ru,en;q=0.8" },
      });
    } catch (e) {
      if (isAbort(e) || signal.aborted) throw new CoverError("timeout");
      throw new CoverError("download_failed");
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel().catch(() => {});
      const loc = res.headers.get("location");
      if (!loc || hop >= MAX_REDIRECTS) throw new CoverError("download_failed");
      try {
        url = new URL(loc, url);
      } catch {
        throw new CoverError("invalid_url");
      }
      continue;
    }
    return { res, url };
  }
}

/** Чтение тела потоком с обрывом при превышении лимита. */
export async function readLimited(res: Response, max: number, signal: AbortSignal, overflow: "too_large" | "truncate" = "too_large") {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (overflow === "too_large" && Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {});
    throw new CoverError("too_large");
  }
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (total + value.length > max) {
        await reader.cancel().catch(() => {});
        if (overflow === "too_large") throw new CoverError("too_large");
        chunks.push(value.subarray(0, max - total));
        total = max;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } catch (e) {
    if (e instanceof CoverError) throw e;
    if (isAbort(e) || signal.aborted) throw new CoverError("timeout");
    throw new CoverError("download_failed");
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const mediaType = (res: Response) => (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309)
// ---------------------------------------------------------------------------

interface Rule {
  allow: boolean;
  pattern: string;
}

function ruleMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${re}${anchored ? "$" : ""}`).test(path);
}

const normPath = (p: string) => {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
};

/** true, если путь разрешён для нашего User-Agent. */
export function robotsAllows(robots: string, pathAndQuery: string, token = BOT_TOKEN_UA): boolean {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!cur || !value) continue; // пустой Disallow ничего не запрещает
      cur.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const t = token.toLowerCase();
  let rules = groups.filter((g) => g.agents.some((a) => a === t || a.split("/")[0] === t)).flatMap((g) => g.rules);
  if (!groups.some((g) => g.agents.some((a) => a === t || a.split("/")[0] === t))) {
    rules = groups.filter((g) => g.agents.includes("*")).flatMap((g) => g.rules);
  }
  const path = normPath(pathAndQuery);
  if (path === "/robots.txt") return true;
  let best: Rule | null = null;
  for (const r of rules) {
    if (!ruleMatches(normPath(r.pattern), path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

async function checkRobots(page: URL, deps: NetDeps) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const robotsUrl = new URL("/robots.txt", page.origin);
  const { res } = await safeGet(robotsUrl, "text/plain,*/*;q=0.5", signal, deps);
  if (res.status >= 400 && res.status < 500) {
    await res.body?.cancel().catch(() => {});
    return; // robots.txt нет — ограничений нет
  }
  if (res.status >= 500) {
    await res.body?.cancel().catch(() => {});
    throw new CoverError("robots_disallowed"); // RFC 9309: недоступен — считаем, что всё запрещено
  }
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel().catch(() => {});
    return;
  }
  const text = new TextDecoder().decode(await readLimited(res, MAX_ROBOTS_BYTES, signal, "truncate"));
  if (!robotsAllows(text, page.pathname + page.search)) throw new CoverError("robots_disallowed");
}

// ---------------------------------------------------------------------------
// Поиск изображения в HTML
// ---------------------------------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([^\s"'<>\/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    const k = m[1].toLowerCase();
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

function tags(html: string, name: string): Record<string, string>[] {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...html.matchAll(re)].map((m) => attrsOf(m[0]));
}

function isProduct(t: unknown): boolean {
  const ok = (x: unknown) => typeof x === "string" && /(^|[/#:])Product$/i.test(x.trim());
  return Array.isArray(t) ? t.some(ok) : ok(t);
}

function imageFromLd(img: unknown): string | null {
  if (typeof img === "string") return img;
  if (Array.isArray(img)) {
    for (const x of img) {
      const r = imageFromLd(x);
      if (r) return r;
    }
    return null;
  }
  if (img && typeof img === "object") {
    const o = img as Record<string, unknown>;
    for (const k of ["url", "contentUrl", "@id"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return null;
}

function findProductImage(node: unknown, depth = 0): string | null {
  if (depth > 8 || !node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const x of node) {
      const r = findProductImage(x, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const o = node as Record<string, unknown>;
  if (isProduct(o["@type"])) {
    const r = imageFromLd(o.image);
    if (r) return r;
  }
  for (const v of Object.values(o)) {
    if (v && typeof v === "object") {
      const r = findProductImage(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** Кандидаты в порядке приоритета, абсолютные http(s)-адреса без повторов. */
export function extractImageCandidates(html: string, pageUrl: URL): string[] {
  let base = pageUrl;
  const baseTag = tags(html, "base").find((a) => a.href);
  if (baseTag) {
    try {
      const b = new URL(baseTag.href, pageUrl);
      if (b.protocol === "http:" || b.protocol === "https:") base = b;
    } catch {
      /* игнорируем битый <base> */
    }
  }

  const metas = tags(html, "meta");
  const metaVal = (...keys: string[]) =>
    keys.flatMap((k) =>
      metas.filter((a) => (a.property ?? a.name ?? "").toLowerCase() === k && a.content).map((a) => a.content),
    );

  const raw: string[] = [];
  raw.push(...metaVal("og:image:secure_url", "og:image", "og:image:url"));
  raw.push(...metaVal("twitter:image", "twitter:image:src"));
  raw.push(
    ...tags(html, "link")
      .filter((a) => (a.rel ?? "").toLowerCase().split(/\s+/).includes("image_src") && a.href)
      .map((a) => a.href),
  );
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1].trim().replace(/^<!--|-->$/g, "").replace(/^\s*\/\/\s*<!\[CDATA\[|\/\/\s*\]\]>\s*$/g, "");
    try {
      const img = findProductImage(JSON.parse(body));
      if (img) raw.push(img);
    } catch {
      /* битый JSON-LD пропускаем */
    }
  }

  const out: string[] = [];
  for (const r of raw) {
    try {
      const u = new URL(r.trim(), base);
      if ((u.protocol === "http:" || u.protocol === "https:") && !out.includes(u.href)) out.push(u.href);
    } catch {
      /* пропускаем */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Загрузка страницы и картинки
// ---------------------------------------------------------------------------

export async function fetchPageHtml(page: URL, deps: NetDeps): Promise<{ html: string; url: URL }> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const { res, url } = await safeGet(page, "text/html,application/xhtml+xml;q=0.9", signal, deps);
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel().catch(() => {});
    throw new CoverError("download_failed");
  }
  if (mediaType(res) !== "text/html") {
    await res.body?.cancel().catch(() => {});
    throw new CoverError("not_html");
  }
  const bytes = await readLimited(res, MAX_HTML_BYTES, signal);
  return { html: new TextDecoder().decode(bytes), url };
}

function sniffImage(b: Uint8Array): boolean {
  const s = (i: number, str: string) => [...str].every((c, j) => b[i + j] === c.charCodeAt(0));
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // JPEG
    (b[0] === 0x89 && s(1, "PNG")) || // PNG
    (s(0, "RIFF") && s(8, "WEBP")) // WebP
  );
}

export async function downloadImage(src: URL, deps: NetDeps): Promise<Uint8Array> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const { res } = await safeGet(src, "image/webp,image/jpeg,image/png;q=0.9", signal, deps);
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel().catch(() => {});
    throw new CoverError("download_failed");
  }
  let type = mediaType(res);
  if (type === "image/jpg" || type === "image/pjpeg") type = "image/jpeg";
  if (!IMAGE_TYPES.has(type)) {
    await res.body?.cancel().catch(() => {});
    throw new CoverError("download_failed");
  }
  const bytes = await readLimited(res, MAX_IMAGE_BYTES, signal);
  if (!sniffImage(bytes)) throw new CoverError("download_failed");
  return bytes;
}

/**
 * Полный конвейер: robots.txt → страница → кандидаты → первая скачанная картинка.
 * Возвращает исходные байты изображения; обработка и сохранение делаются отдельно.
 */
export async function findCoverImage(rawUrl: string, deps: NetDeps = defaultDeps): Promise<Uint8Array> {
  const page = parseHttpUrl(normalizeUserUrl(rawUrl));
  await assertPublicHost(page, deps, AbortSignal.timeout(TIMEOUT_MS));
  await checkRobots(page, deps);
  const { html, url } = await fetchPageHtml(page, deps);
  const candidates = extractImageCandidates(html, url).slice(0, 3);
  if (!candidates.length) throw new CoverError("no_image");
  let last: CoverError = new CoverError("download_failed");
  for (const c of candidates) {
    try {
      return await downloadImage(new URL(c), deps);
    } catch (e) {
      if (!(e instanceof CoverError)) throw e;
      last = e;
    }
  }
  throw last;
}
