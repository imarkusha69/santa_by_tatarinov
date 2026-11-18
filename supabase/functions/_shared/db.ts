import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { escapeHtml, sendText } from "./telegram.ts";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Direction = "santa_to_receiver" | "receiver_to_santa";

export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${SUPABASE_URL}/storage/v1/object/public/photos/${path}`;
}

/**
 * Сохраняет сообщение анонимного чата и доставляет его через бота второй стороне.
 * Получатель видит «Тайный Санта», Санта видит имя получателя. Аккаунт отправителя не раскрывается.
 */
export async function deliverMessage(assignmentId: string, direction: Direction, text: string) {
  const { data: a, error } = await db
    .from("assignments")
    .select(
      "id, game:games(invite_code), giver:members!assignments_giver_member_id_fkey(user:users(telegram_id)), receiver:members!assignments_receiver_member_id_fkey(user:users(telegram_id, display_name))",
    )
    .eq("id", assignmentId)
    .single();
  if (error || !a) throw new Error("assignment_not_found");

  const { data: msg, error: insErr } = await db
    .from("messages")
    .insert({ assignment_id: assignmentId, direction, text })
    .select("id, created_at")
    .single();
  if (insErr || !msg) throw new Error("message_insert_failed");

  // deno-lint-ignore no-explicit-any
  const any = a as any;
  const receiverName: string = any.receiver.user.display_name;
  const toChat: number = direction === "santa_to_receiver" ? any.receiver.user.telegram_id : any.giver.user.telegram_id;
  const label = direction === "santa_to_receiver" ? "Тайный Санта" : escapeHtml(receiverName);
  const html = `💌 <b>${label}:</b> ${escapeHtml(text)}\n\n<i>Ответь на это сообщение, чтобы написать в ответ.</i>`;

  const sent = await sendText(toChat, html, { text: "Открыть чат", startParam: any.game.invite_code });
  if (sent) {
    await db.from("bot_message_links").insert({
      chat_id: sent.chat.id,
      message_id: sent.message_id,
      assignment_id: assignmentId,
      reply_direction: direction === "santa_to_receiver" ? "receiver_to_santa" : "santa_to_receiver",
    });
    await db.from("messages").update({ delivered: true }).eq("id", msg.id);
  }
  return { id: msg.id as string, createdAt: msg.created_at as string, delivered: !!sent };
}
