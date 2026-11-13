import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError, storage, useQuery } from "../lib/api";
import { useApp, type ChatSide } from "../lib/app";
import { haptic, lockClosing } from "../lib/telegram";
import type { ChatData, ChatMessage } from "../lib/types";
import { Bells } from "../components/Decor";
import { IconSend } from "../components/Icons";
import { Empty, ErrorBox, Skeleton, Title, formatDay, formatTime } from "../components/ui";

export function ChatScreen({ initialSide }: { initialSide?: ChatSide }) {
  const { game, gameId, toast } = useApp();
  const [side, setSide] = useState<ChatSide>(initialSide ?? storage.get<ChatSide>(`chatSide:${gameId}`) ?? "santa");
  useEffect(() => storage.set(`chatSide:${gameId}`, side), [side, gameId]);
  const drawn = game?.status === "drawn";

  const q = useQuery<ChatData>(drawn ? `chat:${gameId}:${side}` : null, () => api<ChatData>("chat", { gameId, side }), {
    cache: true,
    poll: 5000,
  });

  const draftKey = `draft:chat:${gameId}:${side}`;
  const [text, setText] = useState(() => storage.get<string>(draftKey) ?? "");
  useEffect(() => setText(storage.get<string>(draftKey) ?? ""), [draftKey]);
  useEffect(() => {
    if (text) storage.set(draftKey, text);
    else storage.remove(draftKey);
  }, [text, draftKey]);
  useEffect(() => (text.trim() ? lockClosing() : undefined), [text]);

  const [pending, setPending] = useState<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = [...(q.data?.messages ?? []), ...pending];

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, side]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const tmp: ChatMessage = { id: `tmp-${Date.now()}`, text: t, createdAt: new Date().toISOString(), mine: true, pending: true };
    setPending((p) => [...p, tmp]);
    setText("");
    haptic.tap();
    try {
      const m = await api<ChatMessage>("sendMessage", { gameId, side, text: t });
      setPending((p) => p.filter((x) => x.id !== tmp.id));
      q.setData({ ...(q.data ?? { available: true, title: "", messages: [] }), messages: [...(q.data?.messages ?? []), m] });
    } catch (e) {
      setPending((p) => p.filter((x) => x.id !== tmp.id));
      setText(t);
      haptic.error();
      toast((e as ApiError).message, "error");
    }
  };

  const otherName = side === "santa" ? (q.data?.title || game?.recipient?.name || "Получатель") : "Тайный Санта";

  return (
    <div className="screen chat-screen" ref={scrollRef} style={{ paddingBottom: drawn ? "calc(var(--nav-h) + var(--bottom) + 92px)" : undefined }}>
      <Title main="Анонимный" script="чат" small />
      <div className="switch" role="tablist">
        {(["santa", "receiver"] as ChatSide[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={side === s}
            className={side === s ? "on" : ""}
            onClick={() => {
              haptic.select();
              setSide(s);
              setPending([]);
            }}
          >
            {side === s && <motion.span layoutId="chat-thumb" className="thumb" transition={{ duration: 0.25 }} />}
            {s === "santa" ? "Я пишу получателю" : "Мой Санта пишет мне"}
          </button>
        ))}
      </div>

      {!drawn ? (
        <Empty
          art={<Bells size={80} style={{ position: "relative" }} />}
          title="Чат откроется после жеребьёвки"
          text="Здесь можно будет анонимно расспросить получателя о подарке, а вашему Санте — вас."
        />
      ) : (
        <>
          <p className="muted small center" style={{ margin: "12px 0 0" }}>
            {side === "santa"
              ? `Вы пишете: ${otherName}. Получатель не узнает, кто вы.`
              : "Вам пишет ваш Тайный Санта. Вы не знаете, кто это."}
          </p>
          {q.error && !q.data && <ErrorBox message={q.error.message} onRetry={q.reload} />}
          {!q.data && !q.error ? (
            <div className="messages">
              <Skeleton h={44} w="60%" r={18} />
              <div style={{ alignSelf: "flex-end", width: "50%" }}>
                <Skeleton h={44} r={18} />
              </div>
            </div>
          ) : messages.length === 0 ? (
            <p className="muted center" style={{ marginTop: 40 }}>
              {side === "santa" ? "Сообщений пока нет. Начните разговор первым." : "Санта пока ничего не написал."}
            </p>
          ) : (
            <div className="messages" aria-live="polite">
              <AnimatePresence initial={false}>
                {messages.map((m, i) => {
                  const day = formatDay(m.createdAt);
                  const showDay = i === 0 || formatDay(messages[i - 1].createdAt) !== day;
                  return (
                    <Fragment key={m.id}>
                      {showDay && <div className="day">{day}</div>}
                      <motion.div
                        className={`bubble ${m.mine ? "out" : "in"} ${m.pending ? "pending" : ""}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: m.pending ? 0.6 : 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                      >
                        {!m.mine && <span className="who">{otherName}</span>}
                        {m.text}
                        <time>{formatTime(m.createdAt)}</time>
                      </motion.div>
                    </Fragment>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {drawn && (
        <div className="composer">
          <textarea
            className="input"
            rows={1}
            maxLength={2000}
            placeholder={side === "santa" ? "Сообщение получателю" : "Ответ Санте"}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
          />
          <motion.button className="send" aria-label="Отправить" whileTap={{ scale: 0.92 }} disabled={!text.trim()} onClick={send}>
            <IconSend size={22} />
          </motion.button>
        </div>
      )}
    </div>
  );
}
