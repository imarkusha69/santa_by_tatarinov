// deno test --allow-net --allow-read --allow-env supabase/functions/_shared/cover_test.ts
import {
  assertPublicHost,
  CoverError,
  type CoverReason,
  defaultDeps,
  extractImageCandidates,
  findCoverImage,
  isBlockedIp,
  type NetDeps,
  normalizeUserUrl,
  parseHttpUrl,
  robotsAllows,
} from "./cover.ts";
import { toCover } from "./image.ts";

function eq<T>(a: T, b: T, msg = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}\n  ожидалось: ${JSON.stringify(b)}\n  получено:  ${JSON.stringify(a)}`);
}

async function reason(p: Promise<unknown>): Promise<CoverReason | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (e instanceof CoverError) return e.reason;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Адреса
// ---------------------------------------------------------------------------

Deno.test("частные и служебные IP блокируются", () => {
  for (const ip of [
    "127.0.0.1", "127.255.0.9", "10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "0.0.0.0", "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2002:0a00:0001::1",
    "not-an-ip",
  ]) eq(isBlockedIp(ip), true, ip);
});

Deno.test("публичные IP разрешены", () => {
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.0.1", "2606:4700::1111", "2a00:1450:4010::64"]) {
    eq(isBlockedIp(ip), false, ip);
  }
});

const noDns: NetDeps = { resolve: () => Promise.resolve(["93.184.216.34"]), fetch: () => Promise.reject(new Error("no net")) };
const sig = () => AbortSignal.timeout(5000);

Deno.test("localhost, 10.0.0.1, 169.254.169.254 и их записи в другой форме → blocked_host", async () => {
  for (const u of [
    "http://localhost/", "http://LOCALHOST./x", "http://shop.localhost/", "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/", "http://2130706433/", "http://0x7f.0.0.1/", "http://017700000001/", "http://127.1/",
    "http://[::ffff:169.254.169.254]/", "https://example.com:8443/",
  ]) {
    eq(await reason(assertPublicHost(new URL(u), noDns, sig())), "blocked_host", u);
  }
});

Deno.test("имя, разрешающееся во внутренний IP, блокируется (проверка после DNS)", async () => {
  const evil: NetDeps = { resolve: () => Promise.resolve(["93.184.216.34", "10.1.2.3"]), fetch: noDns.fetch };
  eq(await reason(assertPublicHost(new URL("https://rebind.example/"), evil, sig())), "blocked_host");
});

Deno.test("схемы кроме http/https → invalid_url", () => {
  for (const u of ["ftp://example.com/a", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,1", "https://user:pw@example.com/"]) {
    let r = "ok";
    try {
      parseHttpUrl(normalizeUserUrl(u));
    } catch (e) {
      r = (e as CoverError).reason;
    }
    eq(r, "invalid_url", u);
  }
  eq(normalizeUserUrl("ozon.ru/product/1"), "https://ozon.ru/product/1");
  eq(normalizeUserUrl("example.com:443/x"), "https://example.com:443/x");
});

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

Deno.test("robots.txt: свой UA, *, длиннейшее совпадение, шаблоны", () => {
  const r = `
User-agent: *
Disallow: /cart
Disallow: /*?sort=
Allow: /cart/public

User-agent: SantaCoverBot
User-agent: OtherBot
Disallow: /private
Allow: /private/ok$
`;
  eq(robotsAllows(r, "/product/1"), true);
  eq(robotsAllows(r, "/private/x"), false);
  eq(robotsAllows(r, "/private/ok"), true);
  eq(robotsAllows(r, "/private/ok/more"), false);
  eq(robotsAllows(r, "/cart"), true, "группа * не действует, если есть своя");
  eq(robotsAllows(r, "/cart", "SomeoneElse"), false);
  eq(robotsAllows(r, "/cart/public/1", "SomeoneElse"), true);
  eq(robotsAllows(r, "/list?sort=price", "SomeoneElse"), false);
  eq(robotsAllows("User-agent: *\nDisallow: /", "/anything"), false);
  eq(robotsAllows("User-agent: *\nDisallow:", "/anything"), true);
  eq(robotsAllows("", "/x"), true);
});

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

Deno.test("порядок источников: og → twitter → image_src → JSON-LD, относительные адреса", () => {
  const page = new URL("https://shop.example/catalog/item/1");
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},{"@type":["Product"],"image":[{"@type":"ImageObject","url":"/ld.jpg"}]}]}</script>
    <link rel="image_src" href="img/src.jpg">
    <meta name="twitter:image" content="//cdn.example/tw.jpg">
    <meta content="https://cdn.example/og.jpg?a=1&amp;b=2" property="og:image" />
  </head></html>`;
  eq(extractImageCandidates(html, page), [
    "https://cdn.example/og.jpg?a=1&b=2",
    "https://cdn.example/tw.jpg",
    "https://shop.example/catalog/item/img/src.jpg",
    "https://shop.example/ld.jpg",
  ]);
});

Deno.test("JSON-LD: image строкой, массивом и в mainEntity; <base href>", () => {
  const page = new URL("https://shop.example/p/1");
  eq(extractImageCandidates(`<script type="application/ld+json">{"@type":"Product","image":"a.jpg"}</script>`, page), ["https://shop.example/p/a.jpg"]);
  eq(
    extractImageCandidates(
      `<base href="https://static.example/root/"><script type='application/ld+json'>{"@type":"ItemPage","mainEntity":{"@type":"Product","image":["x.webp","y.webp"]}}</script>`,
      page,
    ),
    ["https://static.example/root/x.webp"],
  );
  eq(extractImageCandidates(`<meta property="og:image" content="data:image/png;base64,AAA">`, page), []);
  eq(extractImageCandidates(`<p>нет картинок</p><script type="application/ld+json">{broken</script>`, page), []);
});

// ---------------------------------------------------------------------------
// Полный прогон на локальном сервере. DNS подменён на публичный адрес,
// запросы уходят на 127.0.0.1 — так проверяется логика без выхода в интернет.
// ---------------------------------------------------------------------------

const jpeg = await Deno.readFile(new URL("./testdata/product.jpg", import.meta.url));
const big = "x".repeat(2 * 1024 * 1024 + 10);

const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, async (req) => {
  const u = new URL(req.url);
  const host = u.searchParams.get("__host") ?? "";
  const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  if (u.pathname === "/robots.txt") {
    if (host === "robots-down.test") return new Response("oops", { status: 503 });
    if (host === "norobots.test") return new Response("nf", { status: 404 });
    return new Response("User-agent: SantaCoverBot\nDisallow: /secret\n", { headers: { "content-type": "text/plain" } });
  }
  switch (u.pathname) {
    case "/og":
      return html(`<meta property="og:image" content="/img/product.jpg">`);
    case "/ld":
      return html(`<script type="application/ld+json">{"@type":"Product","image":{"url":"https://img.test/img/product.jpg"}}</script>`);
    case "/secret":
      return html(`<meta property="og:image" content="/img/product.jpg">`);
    case "/noimg":
      return html(`<title>Товар</title>`);
    case "/json":
      return new Response("{}", { headers: { "content-type": "application/json" } });
    case "/big":
      return html(big);
    case "/big-chunked": {
      const enc = new TextEncoder();
      let sent = 0;
      return new Response(
        new ReadableStream({
          pull(c) {
            if (sent > 3 * 1024 * 1024) return c.close();
            sent += 64 * 1024;
            c.enqueue(enc.encode("y".repeat(64 * 1024)));
          },
        }),
        { headers: { "content-type": "text/html" } },
      );
    }
    case "/slow":
      await new Promise((r) => setTimeout(r, 6500));
      return html("late");
    case "/r1":
      return Response.redirect(`http://${host}/r2`, 302);
    case "/r2":
      return Response.redirect(`http://${host}/r3`, 301);
    case "/r3":
      return Response.redirect(`http://${host}/og`, 307);
    case "/r4":
      return Response.redirect(`http://${host}/r1`, 302);
    case "/to-internal":
      return Response.redirect("http://169.254.169.254/latest/meta-data/", 302);
    case "/img-internal":
      return html(`<meta property="og:image" content="http://10.0.0.5/a.jpg">`);
    case "/img-gif":
      return html(`<meta property="og:image" content="/img/x.gif">`);
    case "/img-huge":
      return html(`<meta property="og:image" content="/img/huge.jpg">`);
    case "/img/product.jpg":
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    case "/img/x.gif":
      return new Response(new Uint8Array([71, 73, 70]), { headers: { "content-type": "image/gif" } });
    case "/img/huge.jpg":
      return new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { "content-type": "image/jpeg" } });
  }
  return new Response("nf", { status: 404 });
});
const port = server.addr.port;

const local: NetDeps = {
  resolve: (host) => Promise.resolve(host.endsWith(".internal-dns.test") ? ["10.9.9.9"] : ["93.184.216.34"]),
  fetch: (input, init) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    const target = new URL(u.pathname + u.search, `http://127.0.0.1:${port}`);
    target.searchParams.set("__host", u.hostname);
    return fetch(target, init);
  },
};

Deno.test({
  name: "интеграция: og:image, JSON-LD, редиректы, ошибки",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await t.step("og:image → копия 3:4 в WebP 600×800", async () => {
      const img = await findCoverImage("http://shop.test/og", local);
      eq(img.length, jpeg.length);
      const webp = await toCover(img, 800, 80);
      eq(String.fromCharCode(...webp.slice(8, 12)), "WEBP");
      // размеры из заголовка VP8 / VP8L / VP8X
      const { ImageMagick } = await import("npm:@imagemagick/magick-wasm@0.0.45");
      const dims = ImageMagick.read(webp, (i) => [i.width, i.height]);
      eq(dims, [600, 800]);
    });
    await t.step("JSON-LD Product.image с другого хоста", async () => eq(await reason(findCoverImage("http://shop.test/ld", local)), "ok"));
    await t.step("ссылка без схемы", async () => eq(await reason(findCoverImage("shop.test/og", local)), "ok"));
    await t.step("3 редиректа — можно", async () => eq(await reason(findCoverImage("http://shop.test/r1", local)), "ok"));
    await t.step("4 редиректа — нельзя", async () => eq(await reason(findCoverImage("http://shop.test/r4", local)), "download_failed"));
    await t.step("редирект на 169.254.169.254 → blocked_host", async () =>
      eq(await reason(findCoverImage("http://shop.test/to-internal", local)), "blocked_host"));
    await t.step("картинка во внутренней сети → blocked_host", async () =>
      eq(await reason(findCoverImage("http://shop.test/img-internal", local)), "blocked_host"));
    await t.step("DNS отдаёт внутренний IP → blocked_host", async () =>
      eq(await reason(findCoverImage("http://evil.internal-dns.test/og", local)), "blocked_host"));
    await t.step("robots.txt запрещает путь", async () =>
      eq(await reason(findCoverImage("http://shop.test/secret", local)), "robots_disallowed"));
    await t.step("robots.txt отвечает 5xx → считаем запретом", async () =>
      eq(await reason(findCoverImage("http://robots-down.test/og", local)), "robots_disallowed"));
    await t.step("robots.txt нет (404) → можно", async () => eq(await reason(findCoverImage("http://norobots.test/og", local)), "ok"));
    await t.step("нет картинки → no_image", async () => eq(await reason(findCoverImage("http://shop.test/noimg", local)), "no_image"));
    await t.step("не text/html → not_html", async () => eq(await reason(findCoverImage("http://shop.test/json", local)), "not_html"));
    await t.step("страница > 2 МБ (Content-Length) → too_large", async () =>
      eq(await reason(findCoverImage("http://shop.test/big", local)), "too_large"));
    await t.step("страница > 2 МБ потоком без длины → too_large", async () =>
      eq(await reason(findCoverImage("http://shop.test/big-chunked", local)), "too_large"));
    await t.step("картинка > 5 МБ → too_large", async () => eq(await reason(findCoverImage("http://shop.test/img-huge", local)), "too_large"));
    await t.step("картинка не jpeg/png/webp → download_failed", async () =>
      eq(await reason(findCoverImage("http://shop.test/img-gif", local)), "download_failed"));
    await t.step("медленнее 5 с → timeout", async () => {
      const t0 = Date.now();
      eq(await reason(findCoverImage("http://shop.test/slow", local)), "timeout");
      const took = Date.now() - t0;
      if (took > 6000) throw new Error(`таймаут сработал поздно: ${took} мс`);
    });
    await t.step("реальные зависимости: localhost и 10.0.0.1 не запрашиваются", async () => {
      eq(await reason(findCoverImage("http://localhost:" + port + "/og", defaultDeps)), "blocked_host");
      eq(await reason(findCoverImage("http://10.0.0.1/", defaultDeps)), "blocked_host");
      eq(await reason(findCoverImage("http://169.254.169.254/latest/meta-data/", defaultDeps)), "blocked_host");
      eq(await reason(findCoverImage("ftp://example.com/", defaultDeps)), "invalid_url");
    });
    await server.shutdown();
  },
});

Deno.test("ручная обложка: широкое фото режется в 3:4 и не растягивается", async () => {
  const webp = await toCover(jpeg, 1200, 85);
  const { ImageMagick } = await import("npm:@imagemagick/magick-wasm@0.0.45");
  eq(ImageMagick.read(webp, (i) => [i.width, i.height]), [675, 900]); // исходник 1200×900, вверх не растягиваем
});
