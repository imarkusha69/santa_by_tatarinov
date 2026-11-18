// deno test --allow-env supabase/functions/_shared/telegram_test.ts
Deno.env.set("TELEGRAM_BOT_TOKEN", "123456:TEST-TOKEN");
const { verifyInitData, randomCode } = await import("./telegram.ts");

const enc = new TextEncoder();
async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function sign(fields: Record<string, string>, token = "123456:TEST-TOKEN") {
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), token);
  const p = new URLSearchParams(fields);
  p.set("hash", hex(await hmac(secret, dcs)));
  return p.toString();
}

const user = JSON.stringify({ id: 42, first_name: "Анна", photo_url: "https://t.me/i/userpic/320/a.jpg" });
const now = String(Math.floor(Date.now() / 1000));

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

Deno.test("валидная подпись принимается", async () => {
  const r = await verifyInitData(await sign({ auth_date: now, user, start_param: "AbCdEfGhJkLmNpQrStUv", query_id: "q" }));
  assert(r?.user.id === 42, "user id");
  assert(r?.startParam === "AbCdEfGhJkLmNpQrStUv", "start param");
});

Deno.test("подделка данных отклоняется", async () => {
  const signed = await sign({ auth_date: now, user });
  const tampered = signed.replace("42", "43");
  assert((await verifyInitData(tampered)) === null, "tampered must fail");
});

Deno.test("чужой токен отклоняется", async () => {
  assert((await verifyInitData(await sign({ auth_date: now, user }, "999:OTHER"))) === null, "other bot");
});

Deno.test("устаревшие данные отклоняются", async () => {
  const old = String(Math.floor(Date.now() / 1000) - 3 * 86400);
  assert((await verifyInitData(await sign({ auth_date: old, user }))) === null, "expired");
});

Deno.test("код приглашения длинный и случайный", () => {
  const a = randomCode(24);
  assert(a.length === 24 && /^[A-Za-z0-9]+$/.test(a) && a !== randomCode(24), "code");
});
