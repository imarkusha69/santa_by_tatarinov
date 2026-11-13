// Единая точка API для mini app. Каждый запрос: проверка подписи initData → действие.
// Все проверки прав (участник игры, организатор, Санта конкретного получателя) делаются здесь на каждый запрос.

import { db, deliverMessage, publicUrl } from "../_shared/db.ts";
import { appLink, escapeHtml, randomCode, sendText, sleep, verifyInitData, type TgUser } from "../_shared/telegram.ts";
import { COVER_REASONS, normalizeUserUrl, type CoverReason } from "../_shared/cover.ts";
import {
  autoPath,
  COVER_BUCKET,
  coverFiles,
  manualPath,
  removeCovers,
  signCovers,
  wishForWrite,
} from "../_shared/covers.ts";

const CORS = {
  "access-control-allow-origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "access-control-allow-headers": "content-type, x-init-data",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

const WISH_NOTIFY_INTERVAL_MS = 3 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}
function fail(status: number, code: string): never {
  throw new HttpError(status, code);
}

// deno-lint-ignore no-explicit-any
type Body = Record<string, any>;
interface UserRow {
  id: string;
  telegram_id: number;
  display_name: string;
  avatar_url: string | null;
  tg_photo_url: string | null;
  bio: string;
}
interface GameRow {
  id: string;
  name: string;
  invite_code: string;
  organizer_user_id: string;
  status: "open" | "drawn";
}
interface MemberRow {
  id: string;
  game_id: string;
  user_id: string;
  family_id: string;
  envelope_opened_at: string | null;
  santa_notified_at: string | null;
}
interface Ctx {
  user: UserRow;
  startParam: string | null;
  body: Body;
}

// ---------- helpers ----------

const str = (v: unknown, max: number, required = false): string | null => {
  if (v === undefined || v === null) return required ? fail(400, "bad_request") : null;
  if (typeof v !== "string") fail(400, "bad_request");
  const t = (v as string).trim();
  if (!t) return required ? fail(400, "bad_request") : null;
  if (t.length > max) fail(400, "too_long");
  return t;
};
const uuid = (v: unknown): string => {
  if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) fail(400, "bad_request");
  return v as string;
};
const avatarOf = (u: Pick<UserRow, "avatar_url" | "tg_photo_url">) => publicUrl(u.avatar_url) ?? u.tg_photo_url ?? null;
const fullName = (u: TgUser) => [u.first_name, u.last_name].filter(Boolean).join(" ").slice(0, 64) || "Участник";

async function ensureUser(tg: TgUser): Promise<UserRow> {
  const { data } = await db.from("users").select("*").eq("telegram_id", tg.id).maybeSingle();
  if (data) {
    if ((tg.photo_url ?? null) !== data.tg_photo_url) {
      await db.from("users").update({ tg_photo_url: tg.photo_url ?? null }).eq("id", data.id);
      data.tg_photo_url = tg.photo_url ?? null;
    }
    return data as UserRow;
  }
  const { data: created, error } = await db
    .from("users")
    .upsert(
      { telegram_id: tg.id, display_name: fullName(tg), tg_photo_url: tg.photo_url ?? null },
      { onConflict: "telegram_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return created as UserRow;
}

async function loadGame(gameId: string): Promise<GameRow> {
  const { data } = await db.from("games").select("*").eq("id", gameId).maybeSingle();
  return (data as GameRow) ?? fail(404, "game_not_found");
}

/** Пользователь обязан быть участником игры. */
async function memberOf(ctx: Ctx, gameId: string) {
  const game = await loadGame(gameId);
  const { data } = await db.from("members").select("*").eq("game_id", gameId).eq("user_id", ctx.user.id).maybeSingle();
  if (!data) fail(403, "not_member");
  return { game, member: data as MemberRow, isOrganizer: game.organizer_user_id === ctx.user.id };
}

/** Только организатор игры. Проверяется на каждый запрос. */
async function organizerOf(ctx: Ctx, gameId: string) {
  const r = await memberOf(ctx, gameId);
  if (!r.isOrganizer) fail(403, "not_organizer");
  return r;
}

/**
 * Желания с обложкой. Обложка отдаётся подписанной ссылкой (bucket закрытый).
 * forOwner=true — ещё и автофото со страницы и ошибка автоподгрузки (нужны только в форме владельца).
 */
async function wishesOf(memberId: string, forOwner: boolean) {
  const { data } = await db
    .from("wishes")
    .select("*, photos:wish_photos(file_url, position)")
    .eq("member_id", memberId)
    .order("priority", { ascending: true })
    .order("created_at", { ascending: false });
  const rows = data ?? [];
  const signed = await signCovers(rows.flatMap((w) => [w.cover_file_url, forOwner ? w.cover_auto_url : null]));
  // deno-lint-ignore no-explicit-any
  return rows.map((w: any) => ({
    id: w.id,
    title: w.title,
    url: w.url,
    price: w.price === null ? null : Number(w.price),
    shop: w.shop,
    priority: w.priority,
    details: w.details ?? {},
    comment: w.comment,
    updatedAt: w.updated_at,
    cover: {
      source: w.cover_file_url && signed.get(w.cover_file_url) ? w.cover_source : "none",
      url: (w.cover_file_url && signed.get(w.cover_file_url)) ?? null,
      autoUrl: forOwner && w.cover_auto_url ? (signed.get(w.cover_auto_url) ?? null) : null,
      error: forOwner ? w.cover_error : null,
      updatedAt: w.cover_updated_at,
    },
    photos: (w.photos ?? [])
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => a.position - b.position)
      // deno-lint-ignore no-explicit-any
      .map((p: any) => ({ base: p.file_url, small: publicUrl(`${p.file_url}@480`), large: publicUrl(`${p.file_url}@1280`) })),
  }));
}

/** Обложка, которую можно записать в строку желания, с учётом реально лежащих файлов. */
async function reconcileCover(
  wishId: string,
  url: string | null,
  // deno-lint-ignore no-explicit-any
  c: any,
) {
  const files = await coverFiles(wishId);
  const hasAuto = !!url && c?.hasAuto === true && files.auto;
  let source: "manual" | "auto" | "none" = c?.source === "manual" || c?.source === "auto" ? c.source : "none";
  if (source === "manual" && !files.manual) source = "none";
  if (source === "auto" && !hasAuto) source = "none";
  const error: CoverReason | null =
    url && !hasAuto && COVER_REASONS.includes(c?.error) ? (c.error as CoverReason) : null;
  return {
    cover_source: source,
    cover_file_url: source === "manual" ? manualPath(wishId) : source === "auto" ? autoPath(wishId) : null,
    cover_auto_url: hasAuto ? autoPath(wishId) : null,
    cover_error: error,
    cover_updated_at: new Date().toISOString(),
  };
}

/** Санте сообщаем об изменении желаний получателя не чаще раза в 3 часа. */
async function notifySanta(game: GameRow, receiver: MemberRow) {
  if (game.status !== "drawn") return;
  if (receiver.santa_notified_at && Date.now() - Date.parse(receiver.santa_notified_at) < WISH_NOTIFY_INTERVAL_MS) return;
  const { data: a } = await db
    .from("assignments")
    .select("giver:members!assignments_giver_member_id_fkey(user:users(telegram_id))")
    .eq("receiver_member_id", receiver.id)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const tgId = (a as any)?.giver?.user?.telegram_id;
  if (!tgId) return;
  await db.from("members").update({ santa_notified_at: new Date().toISOString() }).eq("id", receiver.id);
  await sendText(tgId, "🎁 Твой получатель обновил список желаний.", { text: "Посмотреть", startParam: game.invite_code });
}

async function familiesAndMembers(gameId: string) {
  const [{ data: families }, { data: members }] = await Promise.all([
    db.from("families").select("id, name, position").eq("game_id", gameId).order("position"),
    db
      .from("members")
      .select("id, family_id, user_id, created_at, user:users(display_name, avatar_url, tg_photo_url), wishes(count)")
      .eq("game_id", gameId)
      .order("created_at"),
  ]);
  return { families: families ?? [], members: members ?? [] };
}

// ---------- actions ----------

const actions: Record<string, (ctx: Ctx) => Promise<unknown>> = {
  /** Профиль, список игр и (если открыто по ссылке) превью приглашения. */
  async me(ctx) {
    const { data: rows } = await db
      .from("members")
      .select("game:games(id, name, status, invite_code, organizer_user_id, created_at)")
      .eq("user_id", ctx.user.id);
    // deno-lint-ignore no-explicit-any
    const games = (rows ?? []).map((r: any) => r.game).filter(Boolean).map((g: GameRow & { created_at: string }) => ({
      id: g.id,
      name: g.name,
      status: g.status,
      code: g.invite_code,
      isOrganizer: g.organizer_user_id === ctx.user.id,
      createdAt: g.created_at,
    }));
    let invite = null;
    const code = typeof ctx.body.code === "string" ? ctx.body.code : ctx.startParam;
    if (code && /^[A-Za-z0-9]{20,64}$/.test(code)) {
      const { data: g } = await db.from("games").select("*").eq("invite_code", code).maybeSingle();
      if (g) {
        const { families, members } = await familiesAndMembers(g.id);
        invite = {
          gameId: g.id,
          code: g.invite_code,
          name: g.name,
          status: g.status,
          isMember: games.some((x) => x.id === g.id),
          families: families.map((f) => ({
            id: f.id,
            name: f.name,
            position: f.position,
            count: members.filter((m) => m.family_id === f.id).length,
          })),
        };
      }
    }
    return { user: profileOf(ctx.user), games, invite };
  },

  async createGame(ctx) {
    const name = str(ctx.body.name, 80, true)!;
    const famA = str(ctx.body.familyA, 40, true)!;
    const famB = str(ctx.body.familyB, 40, true)!;
    const myPos = ctx.body.myFamily === 1 ? 1 : 0;
    const { data: game, error } = await db
      .from("games")
      .insert({ name, invite_code: randomCode(24), organizer_user_id: ctx.user.id })
      .select("*")
      .single();
    if (error || !game) throw error;
    const { data: fams, error: fErr } = await db
      .from("families")
      .insert([
        { game_id: game.id, name: famA, position: 0 },
        { game_id: game.id, name: famB, position: 1 },
      ])
      .select("id, position");
    if (fErr || !fams) throw fErr;
    const familyId = fams.find((f) => f.position === myPos)!.id;
    const { error: mErr } = await db.from("members").insert({ game_id: game.id, user_id: ctx.user.id, family_id: familyId });
    if (mErr) throw mErr;
    return { gameId: game.id };
  },

  async joinGame(ctx) {
    const code = str(ctx.body.code, 64, true)!;
    const familyId = uuid(ctx.body.familyId);
    const { data: g } = await db.from("games").select("*").eq("invite_code", code).maybeSingle();
    if (!g) fail(404, "game_not_found");
    if (g.status !== "open") fail(409, "game_closed");
    const { data: existing } = await db.from("members").select("id").eq("game_id", g.id).eq("user_id", ctx.user.id).maybeSingle();
    if (existing) return { gameId: g.id }; // семья выбирается один раз
    const { error } = await db.from("members").insert({ game_id: g.id, user_id: ctx.user.id, family_id: familyId });
    if (error) {
      if (/game_closed/.test(error.message)) fail(409, "game_closed");
      if (/family_mismatch/.test(error.message)) fail(400, "bad_request");
      throw error;
    }
    return { gameId: g.id };
  },

  /** Главная игры: семьи со списками, статус, для организатора — ссылка. */
  async game(ctx) {
    const { game, member, isOrganizer } = await memberOf(ctx, uuid(ctx.body.gameId));
    const { families, members } = await familiesAndMembers(game.id);
    let recipient = null;
    if (game.status === "drawn" && member.envelope_opened_at) {
      recipient = await recipientBrief(member.id);
    }
    return {
      id: game.id,
      name: game.name,
      status: game.status,
      code: game.invite_code,
      isOrganizer,
      inviteLink: isOrganizer ? appLink(game.invite_code) : null,
      families: families.map((f) => ({ id: f.id, name: f.name, position: f.position })),
      // deno-lint-ignore no-explicit-any
      members: members.map((m: any) => ({
        memberId: m.id,
        familyId: m.family_id,
        name: m.user.display_name,
        avatar: avatarOf(m.user),
        isMe: m.id === member.id,
        isOrganizer: m.user_id === game.organizer_user_id,
        // Кто ещё не заполнил желания — видит только организатор.
        wishCount: isOrganizer ? (m.wishes?.[0]?.count ?? 0) : undefined,
      })),
      me: { memberId: member.id, familyId: member.family_id, envelopeOpened: !!member.envelope_opened_at },
      recipient,
    };
  },

  async updateProfile(ctx) {
    const patch: Partial<UserRow> = {};
    if (ctx.body.displayName !== undefined) patch.display_name = str(ctx.body.displayName, 64, true)!;
    if (ctx.body.bio !== undefined) patch.bio = str(ctx.body.bio, 300) ?? "";
    if (ctx.body.avatar === "telegram") patch.avatar_url = null;
    else if (typeof ctx.body.avatar === "string") {
      if (!ctx.body.avatar.startsWith(`avatars/${ctx.user.id}/`)) fail(400, "bad_request");
      patch.avatar_url = ctx.body.avatar;
    }
    const { data, error } = await db.from("users").update(patch).eq("id", ctx.user.id).select("*").single();
    if (error) throw error;
    return profileOf(data as UserRow);
  },

  /** Подписанные URL для загрузки уже сжатых на клиенте фото (480 и 1280 px). */
  async uploadUrls(ctx) {
    const kind = ctx.body.kind === "avatar" ? "avatar" : "wish";
    const count = Math.min(Math.max(Number(ctx.body.count) || 1, 1), 5);
    const out = [];
    for (let i = 0; i < (kind === "avatar" ? 1 : count); i++) {
      const base = `${kind === "avatar" ? "avatars" : "wishes"}/${ctx.user.id}/${crypto.randomUUID()}`;
      const sizes = kind === "avatar" ? ["@320"] : ["@480", "@1280"];
      const urls: Record<string, string> = {};
      for (const s of sizes) {
        const { data, error } = await db.storage.from("photos").createSignedUploadUrl(base + s);
        if (error || !data) throw error ?? new Error("upload_url_failed");
        urls[s.slice(1)] = data.signedUrl;
      }
      out.push({ base: kind === "avatar" ? base + "@320" : base, urls });
    }
    return { items: out };
  },

  async myWishes(ctx) {
    const { member } = await memberOf(ctx, uuid(ctx.body.gameId));
    return { wishes: await wishesOf(member.id, true) };
  },

  /** Подписанный URL для ручной обложки, уже обрезанной и сжатой на клиенте: {wish_id}/manual.webp. */
  async coverUploadUrl(ctx) {
    await memberOf(ctx, uuid(ctx.body.gameId));
    const wishId = uuid(ctx.body.wishId);
    if (!(await wishForWrite(wishId, ctx.user.id))) fail(403, "forbidden");
    const { data, error } = await db.storage.from(COVER_BUCKET).createSignedUploadUrl(manualPath(wishId), { upsert: true });
    if (error || !data) throw error ?? new Error("upload_url_failed");
    return { url: data.signedUrl };
  },

  /**
   * Выбор показываемой обложки: manual (своё фото) или auto (фото со страницы).
   * Для ещё не сохранённого желания ничего не пишет, только возвращает ссылки для превью.
   */
  async setCover(ctx) {
    const { game, member } = await memberOf(ctx, uuid(ctx.body.gameId));
    const wishId = uuid(ctx.body.wishId);
    const source = ctx.body.source === "auto" ? "auto" : "manual";
    const access = await wishForWrite(wishId, ctx.user.id);
    if (!access) fail(403, "forbidden");
    const files = await coverFiles(wishId);
    if (source === "manual" && !files.manual) fail(409, "cover_missing");
    if (source === "auto" && !files.auto) fail(409, "cover_missing");
    if (access!.exists) {
      const path = source === "manual" ? manualPath(wishId) : autoPath(wishId);
      const patch: Record<string, unknown> = {
        cover_source: source,
        cover_file_url: path,
        cover_updated_at: new Date().toISOString(),
      };
      if (source === "auto") patch.cover_auto_url = autoPath(wishId);
      const { error } = await db.from("wishes").update(patch).eq("id", wishId).eq("member_id", member.id);
      if (error) throw error;
      await notifySanta(game, member);
    }
    const signed = await signCovers([files.manual ? manualPath(wishId) : null, files.auto ? autoPath(wishId) : null]);
    return {
      saved: access!.exists,
      manualUrl: signed.get(manualPath(wishId)) ?? null,
      autoUrl: signed.get(autoPath(wishId)) ?? null,
    };
  },

  async saveWish(ctx) {
    const { game, member } = await memberOf(ctx, uuid(ctx.body.gameId));
    const w = ctx.body.wish ?? {};
    const rawUrl = str(w.url, 2000);
    const url = rawUrl ? normalizeUserUrl(rawUrl) : null;
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) fail(400, "bad_url");
    let price: number | null = null;
    if (w.price !== null && w.price !== undefined && w.price !== "") {
      price = Number(w.price);
      if (!Number.isFinite(price) || price < 0 || price > 1e10) fail(400, "bad_price");
    }
    const priority = [1, 2, 3].includes(w.priority) ? w.priority : 2;
    const d = w.details ?? {};
    const details: Record<string, string> = {};
    for (const k of ["color", "size", "model"]) {
      const v = str(d[k], 60);
      if (v) details[k] = v;
    }
    const row = {
      member_id: member.id,
      title: str(w.title, 120, true)!,
      url,
      price,
      shop: str(w.shop, 80),
      priority,
      details,
      comment: str(w.comment, 1000),
      updated_at: new Date().toISOString(),
    };
    const photos: string[] = Array.isArray(w.photos) ? w.photos.slice(0, 5) : [];
    for (const p of photos) {
      if (typeof p !== "string" || !p.startsWith(`wishes/${ctx.user.id}/`) || p.length > 200) fail(400, "bad_request");
    }

    // id нового желания создаёт форма (под него уже могла быть загружена обложка)
    const wishId = w.id ? uuid(w.id) : crypto.randomUUID();
    const { data: existing } = await db.from("wishes").select("id, member_id").eq("id", wishId).maybeSingle();
    if (existing && existing.member_id !== member.id) fail(404, "wish_not_found");
    const cover = await reconcileCover(wishId, url, w.cover);
    if (existing) {
      const { error } = await db.from("wishes").update({ ...row, ...cover }).eq("id", wishId);
      if (error) throw error;
      await db.from("wish_photos").delete().eq("wish_id", wishId);
    } else {
      const { count } = await db.from("wishes").select("id", { count: "exact", head: true }).eq("member_id", member.id);
      if ((count ?? 0) >= 50) fail(400, "too_many_wishes");
      const { error } = await db.from("wishes").insert({ id: wishId, ...row, ...cover });
      if (error) throw error;
    }
    if (photos.length) {
      const { error } = await db
        .from("wish_photos")
        .insert(photos.map((p, i) => ({ wish_id: wishId, file_url: p, position: i })));
      if (error) throw error;
    }
    await notifySanta(game, member);
    return { id: wishId, wishes: await wishesOf(member.id, true) };
  },

  async deleteWish(ctx) {
    const { game, member } = await memberOf(ctx, uuid(ctx.body.gameId));
    const wishId = uuid(ctx.body.wishId);
    const { error, count } = await db
      .from("wishes")
      .delete({ count: "exact" })
      .eq("id", wishId)
      .eq("member_id", member.id);
    if (error) throw error;
    if (count) {
      await removeCovers(wishId);
      await notifySanta(game, member);
    }
    return { wishes: await wishesOf(member.id, true) };
  },

  /** «Мой получатель»: только для его Санты, получатель ищется по моему member_id, без id от клиента. */
  async recipient(ctx) {
    const { game, member } = await memberOf(ctx, uuid(ctx.body.gameId));
    if (game.status !== "drawn") fail(409, "not_drawn");
    const brief = await recipientBrief(member.id);
    if (!brief) fail(404, "not_found");
    return { ...brief, wishes: await wishesOf(brief.memberId, false) };
  },

  async openEnvelope(ctx) {
    const { game, member } = await memberOf(ctx, uuid(ctx.body.gameId));
    if (game.status !== "drawn") fail(409, "not_drawn");
    if (!member.envelope_opened_at) {
      await db.from("members").update({ envelope_opened_at: new Date().toISOString() }).eq("id", member.id);
    }
    return recipientBrief(member.id);
  },

  /** side=santa: я пишу своему получателю; side=receiver: мне пишет мой Санта. */
  async chat(ctx) {
    const { game, member } = await memberOf(ctx, uuid(ctx.body.gameId));
    if (game.status !== "drawn") return { available: false, title: "", messages: [] };
    const side = ctx.body.side === "receiver" ? "receiver" : "santa";
    const a = await myAssignment(member.id, side);
    const { data: msgs } = await db
      .from("messages")
      .select("id, direction, text, created_at")
      .eq("assignment_id", a.id)
      .order("created_at")
      .limit(500);
    const mine = side === "santa" ? "santa_to_receiver" : "receiver_to_santa";
    return {
      available: true,
      title: side === "santa" ? a.receiverName : "Тайный Санта",
      messages: (msgs ?? []).map((m) => ({ id: m.id, text: m.text, createdAt: m.created_at, mine: m.direction === mine })),
    };
  },

  async sendMessage(ctx) {
    const { game, member } = await memberOf(ctx, uuid(ctx.body.gameId));
    if (game.status !== "drawn") fail(409, "not_drawn");
    const side = ctx.body.side === "receiver" ? "receiver" : "santa";
    const text = str(ctx.body.text, 2000, true)!;
    const a = await myAssignment(member.id, side);
    const r = await deliverMessage(a.id, side === "santa" ? "santa_to_receiver" : "receiver_to_santa", text);
    return { id: r.id, text, createdAt: r.createdAt, mine: true, delivered: r.delivered };
  },

  // ---------- организатор ----------

  async draw(ctx) {
    const { game } = await organizerOf(ctx, uuid(ctx.body.gameId));
    const { error } = await db.rpc("perform_draw", { p_game_id: game.id });
    if (error) {
      const code = ["families_unequal", "already_drawn", "draw_verification_failed"].find((c) => error.message.includes(c));
      fail(409, code ?? "draw_failed");
    }
    // Уведомления всем участникам; результат пар в тексте не раскрывается.
    const { data: members } = await db.from("members").select("user:users(telegram_id)").eq("game_id", game.id);
    for (const m of members ?? []) {
      // deno-lint-ignore no-explicit-any
      const tgId = (m as any).user?.telegram_id;
      if (!tgId) continue;
      await sendText(tgId, `🎄 Жеребьёвка в игре «${escapeHtml(game.name)}» проведена! Открой свой конверт.`, {
        text: "Открыть конверт",
        startParam: game.invite_code,
      });
      await sleep(40); // ниже лимита Telegram ~30 сообщений/с
    }
    return { ok: true };
  },

  async moveMember(ctx) {
    const { game } = await organizerOf(ctx, uuid(ctx.body.gameId));
    if (game.status !== "open") fail(409, "game_closed");
    const { error, count } = await db
      .from("members")
      .update({ family_id: uuid(ctx.body.familyId) }, { count: "exact" })
      .eq("id", uuid(ctx.body.memberId))
      .eq("game_id", game.id);
    if (error) fail(/game_closed/.test(error.message) ? 409 : 400, /game_closed/.test(error.message) ? "game_closed" : "bad_request");
    if (!count) fail(404, "not_found");
    return { ok: true };
  },

  async remind(ctx) {
    const { game } = await organizerOf(ctx, uuid(ctx.body.gameId));
    const { data } = await db.from("members").select("id, user:users(telegram_id), wishes(count)").eq("game_id", game.id);
    // deno-lint-ignore no-explicit-any
    const empty = (data ?? []).filter((m: any) => (m.wishes?.[0]?.count ?? 0) === 0);
    let sent = 0;
    for (const m of empty) {
      // deno-lint-ignore no-explicit-any
      const tgId = (m as any).user?.telegram_id;
      const ok = await sendText(
        tgId,
        `✨ Напоминание из игры «${escapeHtml(game.name)}»: твой Тайный Санта ждёт список желаний. Добавь хотя бы одно.`,
        { text: "Добавить желание", startParam: game.invite_code },
      );
      if (ok) sent++;
      await sleep(40);
    }
    return { sent, total: empty.length };
  },

  /** Полная таблица пар и все чаты — только организатору. */
  async organizer(ctx) {
    const { game } = await organizerOf(ctx, uuid(ctx.body.gameId));
    if (game.status !== "drawn") return { pairs: [] };
    const { data: rows } = await db
      .from("assignments")
      .select(
        `id,
         giver:members!assignments_giver_member_id_fkey(id, family:families(name, position), user:users(display_name, avatar_url, tg_photo_url)),
         receiver:members!assignments_receiver_member_id_fkey(id, family:families(name, position), user:users(display_name, avatar_url, tg_photo_url)),
         messages(id, direction, text, created_at)`,
      )
      .eq("game_id", game.id);
    // deno-lint-ignore no-explicit-any
    const person = (m: any) => ({
      memberId: m.id,
      name: m.user.display_name,
      avatar: avatarOf(m.user),
      familyName: m.family.name,
      familyPosition: m.family.position,
    });
    // deno-lint-ignore no-explicit-any
    const pairs = (rows ?? []).map((r: any) => {
      // deno-lint-ignore no-explicit-any
      const msgs = [...(r.messages ?? [])].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));
      const last = msgs[msgs.length - 1];
      return {
        assignmentId: r.id,
        santa: person(r.giver),
        receiver: person(r.receiver),
        count: msgs.length,
        // deno-lint-ignore no-explicit-any
        fromSanta: msgs.filter((m: any) => m.direction === "santa_to_receiver").length,
        last: last ? { text: last.text, createdAt: last.created_at, direction: last.direction } : null,
      };
    });
    // Порядок по кругу: начинаем с любого и идём по цепочке
    const byGiver = new Map(pairs.map((p) => [p.santa.memberId, p]));
    const ordered = [];
    let cur = pairs.find((p) => p.santa.familyPosition === 0) ?? pairs[0];
    while (cur && ordered.length < pairs.length) {
      ordered.push(cur);
      cur = byGiver.get(cur.receiver.memberId)!;
    }
    return { pairs: ordered.length === pairs.length ? ordered : pairs };
  },

  async organizerChat(ctx) {
    const { game } = await organizerOf(ctx, uuid(ctx.body.gameId));
    const id = uuid(ctx.body.assignmentId);
    const { data: a } = await db
      .from("assignments")
      .select(
        "id, game_id, giver:members!assignments_giver_member_id_fkey(user:users(display_name)), receiver:members!assignments_receiver_member_id_fkey(user:users(display_name))",
      )
      .eq("id", id)
      .eq("game_id", game.id)
      .maybeSingle();
    if (!a) fail(404, "not_found");
    const { data: msgs } = await db
      .from("messages")
      .select("id, direction, text, created_at, delivered")
      .eq("assignment_id", id)
      .order("created_at");
    // deno-lint-ignore no-explicit-any
    const any = a as any;
    return {
      santaName: any.giver.user.display_name,
      receiverName: any.receiver.user.display_name,
      messages: (msgs ?? []).map((m) => ({
        id: m.id,
        text: m.text,
        createdAt: m.created_at,
        direction: m.direction,
        delivered: m.delivered,
      })),
    };
  },
};

function profileOf(u: UserRow) {
  return {
    name: u.display_name,
    bio: u.bio,
    avatar: avatarOf(u),
    avatarSource: u.avatar_url ? "custom" : u.tg_photo_url ? "telegram" : "none",
    tgAvatar: u.tg_photo_url,
  };
}

async function recipientBrief(myMemberId: string) {
  const { data } = await db
    .from("assignments")
    .select(
      "receiver:members!assignments_receiver_member_id_fkey(id, family:families(name), user:users(display_name, avatar_url, tg_photo_url, bio))",
    )
    .eq("giver_member_id", myMemberId)
    .maybeSingle();
  // deno-lint-ignore no-explicit-any
  const r = (data as any)?.receiver;
  if (!r) return null;
  return {
    memberId: r.id as string,
    name: r.user.display_name,
    avatar: avatarOf(r.user),
    bio: r.user.bio,
    familyName: r.family.name,
  };
}

async function myAssignment(memberId: string, side: "santa" | "receiver") {
  const { data } = await db
    .from("assignments")
    .select("id, receiver:members!assignments_receiver_member_id_fkey(user:users(display_name))")
    .eq(side === "santa" ? "giver_member_id" : "receiver_member_id", memberId)
    .maybeSingle();
  if (!data) fail(404, "not_found");
  // deno-lint-ignore no-explicit-any
  return { id: (data as any).id as string, receiverName: (data as any).receiver.user.display_name as string };
}

// ---------- server ----------

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  try {
    const init = await verifyInitData(req.headers.get("x-init-data") ?? "");
    if (!init) return json(401, { error: "unauthorized" });
    const body = (await req.json().catch(() => ({}))) as Body;
    const handler = actions[body.action];
    if (!handler) return json(404, { error: "unknown_action" });
    const user = await ensureUser(init.user);
    return json(200, await handler({ user, startParam: init.startParam, body }));
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.code });
    console.error(e);
    return json(500, { error: "server" });
  }
});
