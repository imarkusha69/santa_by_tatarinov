import { api } from "../lib/api";
import { useApp } from "../lib/app";
import { useQuery } from "../lib/api";
import type { Recipient } from "../lib/types";
import { Bells, GiftBox, Ornament } from "../components/Decor";
import { IconChat, IconEnvelope } from "../components/Icons";
import { Avatar, Btn, Empty, ErrorBox, Item, Skeleton, Stagger, Title } from "../components/ui";
import { WishCard, WishGridSkeleton, sortByPriority } from "../components/WishCard";

export function RecipientScreen() {
  const { game, gameId, push, goTab } = useApp();
  const ready = game?.status === "drawn" && game.me.envelopeOpened;
  const q = useQuery<Recipient>(ready ? `recipient:${gameId}` : null, () => api<Recipient>("recipient", { gameId }), {
    cache: true,
  });

  if (!game) {
    return (
      <div className="screen">
        <Skeleton h={90} w="70%" />
      </div>
    );
  }

  if (game.status !== "drawn") {
    return (
      <div className="screen">
        <Ornament tone="cream" size={60} thread={70} style={{ top: -6, right: 16 }} />
        <Stagger>
          <Title main="Мой" script="получатель" />
          <Empty
            art={<GiftBox size={120} style={{ position: "relative" }} />}
            title="Ещё рано"
            text="Получатель появится после жеребьёвки. А пока заполните свой список желаний."
          >
            <Btn className="secondary" onClick={() => goTab("wishes")}>
              К моим желаниям
            </Btn>
          </Empty>
        </Stagger>
      </div>
    );
  }

  if (!game.me.envelopeOpened) {
    return (
      <div className="screen">
        <Stagger>
          <Title main="Мой" script="получатель" />
          <Empty art={<Bells size={90} style={{ position: "relative" }} />} title="Конверт ждёт" text="Откройте конверт, чтобы узнать, кому вы дарите подарок.">
            <Btn onClick={() => push({ name: "envelope" })}>
              <IconEnvelope size={22} /> Открыть конверт
            </Btn>
          </Empty>
        </Stagger>
      </div>
    );
  }

  const r = q.data;
  return (
    <div className="screen with-sticky">
      <Ornament tone="red" size={66} thread={56} style={{ top: -6, right: 6 }} />
      <Stagger>
        <Title main="Мой" script="получатель" />
        {q.error && !r && <ErrorBox message={q.error.message} onRetry={q.reload} />}
        {!r ? (
          <>
            <Skeleton h={120} r={20} />
            <div className="spacer" />
            <WishGridSkeleton />
          </>
        ) : (
          <>
            <Item className="card">
              <div className="recipient-hero">
                <Avatar src={r.avatar} name={r.name} size={76} />
                <div style={{ minWidth: 0 }}>
                  <h2>{r.name}</h2>
                  <div className="muted small">{r.familyName}</div>
                </div>
              </div>
              {r.bio ? (
                <p className="pre" style={{ margin: "14px 0 0" }}>
                  {r.bio}
                </p>
              ) : (
                <p className="muted small" style={{ margin: "14px 0 0" }}>
                  Пока ничего не рассказал о себе.
                </p>
              )}
            </Item>
            <Item>
              <h2 className="h2">Желания · {r.wishes.length}</h2>
              {r.wishes.length === 0 ? (
                <div className="glass">
                  <b>Список пока пуст.</b>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>
                    Спросите анонимно, что бы порадовало. Когда список обновится, бот пришлёт уведомление.
                  </p>
                </div>
              ) : (
                <div className="wish-grid">
                  {sortByPriority(r.wishes).map((w) => (
                    <WishCard key={w.id} wish={w} onOpen={() => push({ name: "wish", wish: w, owner: false })} />
                  ))}
                </div>
              )}
            </Item>
          </>
        )}
      </Stagger>
      <div className="sticky-cta">
        <Btn onClick={() => goTab("chat", "santa")}>
          <IconChat size={22} /> Написать анонимно
        </Btn>
      </div>
    </div>
  );
}
