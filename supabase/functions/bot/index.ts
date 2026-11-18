// Вебхук Telegram-бота: /start и ответы в анонимном чате реплаем на сообщение бота.

import { db, deliverMessage, type Direction } from "../_shared/db.ts";
import { botCall, sendText } from "../_shared/telegram.ts";

const SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

const ok = () => new Response("ok");

interface Msg {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number };
  text?: string;
  reply_to_message?: { message_id: number };
}

async function handle(msg: Msg) {
  if (msg.chat.type !== "private") return;
  const text = msg.text?.trim();

  if (text?.startsWith("/start")) {
    const payload = text.split(/\s+/)[1];
    await sendText(
      msg.chat.id,
      "🎅 <b>Тайный Санта для двух семей</b>\n\nСоздай игру, позови обе семьи по ссылке, собери списки желаний и проведи жеребьёвку. Здесь же будут приходить анонимные сообщения от твоего Санты.",
      { text: "Открыть приложение", startParam: payload && /^[A-Za-z0-9]{20,64}$/.test(payload) ? payload : undefined },
    );
    return;
  }

  if (msg.reply_to_message) {
    const { data: link } = await db
      .from("bot_message_links")
      .select("assignment_id, reply_direction")
      .eq("chat_id", msg.chat.id)
      .eq("message_id", msg.reply_to_message.message_id)
      .maybeSingle();
    if (link) {
      if (!text) {
        await sendText(msg.chat.id, "Пока можно отправлять только текст.");
        return;
      }
      await deliverMessage(link.assignment_id, link.reply_direction as Direction, text.slice(0, 2000));
      await botCall("setMessageReaction", {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        reaction: [{ type: "emoji", emoji: "👍" }],
      });
      return;
    }
  }

  await sendText(
    msg.chat.id,
    "Чтобы ответить в анонимном чате, ответь (reply) на сообщение с 💌. Или открой чат в приложении.",
    { text: "Открыть приложение" },
  );
}

Deno.serve(async (req) => {
  if (!SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const update = await req.json();
    if (update.message) await handle(update.message as Msg);
  } catch (e) {
    console.error(e);
  }
  return ok(); // всегда 200, чтобы Telegram не повторял апдейт
});
