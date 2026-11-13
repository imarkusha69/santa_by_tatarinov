import { motion } from "motion/react";
import { Fragment, useState } from "react";
import { api, ApiError, useQuery } from "../lib/api";
import { useApp } from "../lib/app";
import { confirmDialog, haptic } from "../lib/telegram";
import type { MemberPublic, OrgChat, OrgPair } from "../lib/types";
import { GiftBox, Ornament } from "../components/Decor";
import { IconArrow, IconBell, IconEye, IconLock, IconSwap } from "../components/Icons";
import { Avatar, Btn, ErrorBox, Item, Skeleton, Stagger, Title, formatDay, formatTime, formatWhen } from "../components/ui";

export function OrganizerScreen() {
  const { game, gameId, reloadGame, toast, push } = useApp();
  const drawn = game?.status === "drawn";
  const q = useQuery<{ pairs: OrgPair[] }>(drawn ? `org:${gameId}` : null, () => api("organizer", { gameId }), {
    poll: 15000,
  });
  const [moving, setMoving] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);

  if (!game) return <div className="screen no-nav" />;
  if (!game.isOrganizer) {
    return (
      <div className="screen no-nav">
        <ErrorBox message="Панель доступна только организатору." />
      </div>
    );
  }

  const move = async (m: MemberPublic) => {
    const target = game.families.find((f) => f.id !== m.familyId)!;
    if (!(await confirmDialog(`Перенести ${m.name} в семью «${target.name}»?`))) return;
    setMoving(m.memberId);
    try {
      await api("moveMember", { gameId, memberId: m.memberId, familyId: target.id });
      haptic.success();
      await reloadGame();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setMoving(null);
    }
  };

  const noWishes = game.members.filter((m) => (m.wishCount ?? 0) === 0);
  const remind = async () => {
    if (!(await confirmDialog(`Отправить напоминание ${noWishes.length} участникам без желаний?`))) return;
    setReminding(true);
    try {
      const r = await api<{ sent: number; total: number }>("remind", { gameId });
      haptic.success();
      toast(
        r.sent === r.total
          ? `Напоминание отправлено: ${r.sent}`
          : `Отправлено ${r.sent} из ${r.total}. Кто-то ещё не разрешил боту писать.`,
      );
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setReminding(false);
    }
  };

  const pairs = q.data?.pairs ?? [];
  const silent = pairs.filter((p) => p.count === 0).length;

  return (
    <div className="screen no-nav">
      <Ornament tone="green" size={66} thread={60} style={{ top: -6, right: 4 }} />
      <Stagger>
        <Title main="Панель" script="организатора" small />

        <Item className="card" style={{ marginBottom: 16 }}>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <IconBell />
            <div style={{ flex: 1 }}>
              <b>Без желаний: {noWishes.length}</b>
              <p className="muted small" style={{ margin: "2px 0 0" }}>
                {noWishes.length ? noWishes.map((m) => m.name).join(", ") : "Все добавили хотя бы одно желание."}
              </p>
            </div>
          </div>
          {noWishes.length > 0 && (
            <>
              <div className="spacer" />
              <Btn className="secondary" disabled={reminding} onClick={remind}>
                {reminding ? "Отправляем…" : "Напомнить через бота"}
              </Btn>
            </>
          )}
        </Item>

        {!drawn ? (
          <Item className="card">
            <h2 className="h2" style={{ marginTop: 0 }}>
              Участники
            </h2>
            <p className="muted small" style={{ marginTop: -6 }}>
              До жеребьёвки можно перенести участника в другую семью, если он ошибся при входе.
            </p>
            {game.families.map((f) => (
              <Fragment key={f.id}>
                <div className="family-name" style={{ margin: "16px 0 8px", fontSize: 14 }}>
                  {f.name} · {game.members.filter((m) => m.familyId === f.id).length}
                </div>
                <div className="people">
                  {game.members
                    .filter((m) => m.familyId === f.id)
                    .map((m) => (
                      <div className="person" key={m.memberId}>
                        <Avatar src={m.avatar} name={m.name} size={40} />
                        <span className="person-name">{m.name}</span>
                        <button
                          className="icon-btn"
                          aria-label={`Перенести ${m.name} в другую семью`}
                          disabled={!!moving}
                          style={{ color: "var(--accent)", opacity: moving === m.memberId ? 0.4 : 1 }}
                          onClick={() => move(m)}
                        >
                          <IconSwap size={22} />
                        </button>
                      </div>
                    ))}
                </div>
              </Fragment>
            ))}
          </Item>
        ) : (
          <>
            <Item className="readonly">
              <IconLock size={18} /> Пары видите только вы. Перенос участников после жеребьёвки недоступен.
            </Item>
            {q.error && !q.data && <ErrorBox message={q.error.message} onRetry={q.reload} />}
            <Item className="card">
              <h2 className="h2" style={{ marginTop: 0 }}>
                Кто кому дарит
              </h2>
              {!q.data ? (
                <div className="stack">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} h={44} />
                  ))}
                </div>
              ) : (
                pairs.map((p) => (
                  <div className="pair" key={p.assignmentId}>
                    <PersonCell p={p.santa} />
                    <span className="arrow">
                      <IconArrow size={20} />
                    </span>
                    <PersonCell p={p.receiver} />
                  </div>
                ))
              )}
            </Item>

            <Item className="card" style={{ marginTop: 16 }}>
              <h2 className="h2" style={{ marginTop: 0 }}>
                Чаты
              </h2>
              {q.data && (
                <p className="muted small" style={{ marginTop: -6 }}>
                  Молчат: {silent} из {pairs.length}. Счётчик — всего сообщений в паре.
                </p>
              )}
              {pairs.map((p) => (
                <motion.button
                  key={p.assignmentId}
                  className="chat-row"
                  whileTap={{ scale: 0.98 }}
                  onClick={() => push({ name: "orgChat", assignmentId: p.assignmentId, title: `${p.santa.name} → ${p.receiver.name}` })}
                >
                  <Avatar src={p.santa.avatar} name={p.santa.name} size={40} />
                  <div className="body">
                    <div className="ttl">
                      {p.santa.name} → {p.receiver.name}
                    </div>
                    <div className="last">
                      {p.last
                        ? `${p.last.direction === "santa_to_receiver" ? "Санта" : p.receiver.name}: ${p.last.text}`
                        : "Нет сообщений"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className={`count-badge ${p.count === 0 ? "zero" : ""}`}>{p.count}</div>
                    {p.last && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{formatWhen(p.last.createdAt)}</div>}
                  </div>
                </motion.button>
              ))}
            </Item>
          </>
        )}
      </Stagger>
      <GiftBox size={84} style={{ position: "fixed", bottom: 12, right: -18 }} />
    </div>
  );
}

function PersonCell({ p }: { p: OrgPair["santa"] }) {
  return (
    <div className="side">
      <Avatar src={p.avatar} name={p.name} size={34} />
      <div>
        <div className="nm">{p.name}</div>
        <div className="fam">{p.familyName}</div>
      </div>
    </div>
  );
}

export function OrganizerChat({ assignmentId, title }: { assignmentId: string; title: string }) {
  const { gameId } = useApp();
  const q = useQuery<OrgChat>(`orgchat:${assignmentId}`, () => api<OrgChat>("organizerChat", { gameId, assignmentId }), {
    poll: 10000,
  });
  const msgs = q.data?.messages ?? [];
  return (
    <div className="screen no-nav">
      <Title main="Переписка" script="пары" small />
      <div className="readonly">
        <IconEye size={18} /> {title}. Только чтение.
      </div>
      {q.error && !q.data && <ErrorBox message={q.error.message} onRetry={q.reload} />}
      {!q.data && !q.error ? (
        <div className="messages">
          <Skeleton h={44} w="60%" r={18} />
        </div>
      ) : msgs.length === 0 ? (
        <p className="center" style={{ marginTop: 40, opacity: 0.85 }}>
          В этой паре пока никто не писал.
        </p>
      ) : (
        <div className="messages">
          {msgs.map((m, i) => {
            const day = formatDay(m.createdAt);
            const showDay = i === 0 || formatDay(msgs[i - 1].createdAt) !== day;
            const fromSanta = m.direction === "santa_to_receiver";
            return (
              <Fragment key={m.id}>
                {showDay && <div className="day">{day}</div>}
                <motion.div
                  className={`bubble ${fromSanta ? "out" : "in"}`}
                  style={fromSanta ? { background: "var(--pine)" } : undefined}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <span className="who" style={fromSanta ? { color: "var(--gold)" } : undefined}>
                    {fromSanta ? `${q.data!.santaName} (Санта)` : q.data!.receiverName}
                  </span>
                  {m.text}
                  <time>
                    {formatTime(m.createdAt)}
                    {!m.delivered && " · не доставлено"}
                  </time>
                </motion.div>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
