import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/app";
import { confirmDialog, copyText, haptic, shareLink } from "../lib/telegram";
import type { GameState, MemberPublic } from "../lib/types";
import { Bells, Ornament } from "../components/Decor";
import { IconArrow, IconCopy, IconCrown, IconEnvelope, IconShare, IconShuffle } from "../components/Icons";
import { Avatar, Btn, ErrorBox, Item, Skeleton, Stagger, Title } from "../components/ui";

/** Обновлять данные игры при возврате в приложение. */
export function useRefreshOnFocus(fn: () => void) {
  useEffect(() => {
    const h = () => document.visibilityState === "visible" && fn();
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [fn]);
}

export function GameScreen() {
  const { game, gameError, reloadGame, toLobby } = useApp();
  useEffect(() => {
    void reloadGame();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useRefreshOnFocus(reloadGame);

  return (
    <div className="screen">
      <Ornament tone="red" size={78} thread={70} style={{ top: -6, right: -14 }} />
      <Ornament tone="green" size={54} thread={120} style={{ top: -6, right: 62 }} dur={6} />
      <Stagger>
        <Title main="Тайный" script="Санта" />
        {gameError && !game && <ErrorBox message={gameError.message} onRetry={reloadGame} />}
        {!game ? (
          <GameSkeleton />
        ) : (
          <>
            <Item className="status">
              <span className="chip gold">{game.name}</span>
              <span className="chip">{game.status === "open" ? "Набор участников" : "Жеребьёвка проведена"}</span>
            </Item>
            {game.status === "drawn" && <EnvelopeBlock game={game} />}
            {game.isOrganizer && <OrganizerBlock game={game} />}
            <Item className="families">
              {game.families.map((f) => (
                <FamilyCard
                  key={f.id}
                  name={f.name}
                  members={game.members.filter((m) => m.familyId === f.id)}
                  mine={f.id === game.me.familyId}
                />
              ))}
            </Item>
            <Item>
              <div className="spacer" />
              <button className="link-btn" onClick={toLobby}>
                Другие игры
              </button>
            </Item>
          </>
        )}
      </Stagger>
    </div>
  );
}

function GameSkeleton() {
  return (
    <div className="stack">
      <Skeleton h={30} w="55%" r={999} />
      <Skeleton h={200} r={20} />
      <Skeleton h={200} r={20} />
    </div>
  );
}

function FamilyCard({ name, members, mine }: { name: string; members: MemberPublic[]; mine: boolean }) {
  return (
    <div className="card">
      <div className="family-head">
        <div>
          <div className="family-name">{name}</div>
          {mine && <div className="muted small">ваша семья</div>}
        </div>
        <div className="family-count">{members.length}</div>
      </div>
      {members.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Пока никого. Отправьте ссылку-приглашение.
        </p>
      ) : (
        <div className="people">
          {members.map((m) => (
            <div className="person" key={m.memberId}>
              <Avatar src={m.avatar} name={m.name} size={40} />
              <span className="person-name">{m.name}</span>
              {m.isMe && <span className="tag">вы</span>}
              {m.isOrganizer && <span className="tag red">орг.</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EnvelopeBlock({ game }: { game: GameState }) {
  const { push, goTab } = useApp();
  if (!game.me.envelopeOpened) {
    return (
      <Item style={{ marginBottom: 16 }}>
        <motion.button
          className="card"
          style={{ width: "100%", background: "var(--velvet)", color: "var(--accent-text)", boxShadow: "0 6px 0 #5e0a11, 0 14px 30px rgba(0,0,0,.3)", display: "flex", alignItems: "center", gap: 14, textAlign: "left", minHeight: 96 }}
          whileTap={{ scale: 0.97 }}
          animate={{ scale: [1, 1.015, 1] }}
          transition={{ scale: { duration: 2.4, repeat: Infinity, ease: "easeInOut" } }}
          onClick={() => {
            haptic.tap();
            push({ name: "envelope" });
          }}
        >
          <span style={{ width: 56, height: 56, borderRadius: 16, background: "var(--gold)", color: "var(--ink)", display: "grid", placeItems: "center", flex: "none" }}>
            <IconEnvelope size={30} />
          </span>
          <span style={{ flex: 1 }}>
            <b style={{ fontFamily: "var(--font-head)", textTransform: "uppercase", fontSize: 16 }}>Открыть конверт</b>
            <span style={{ display: "block", fontSize: 13, opacity: 0.85 }}>Узнай, кому ты даришь подарок</span>
          </span>
        </motion.button>
      </Item>
    );
  }
  const r = game.recipient;
  return (
    <Item className="card" style={{ marginBottom: 16 }}>
      <div className="muted small">Ты Тайный Санта для</div>
      <div className="row" style={{ marginTop: 8 }}>
        <Avatar src={r?.avatar} name={r?.name ?? "?"} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{r?.name}</div>
          <div className="muted small">{r?.familyName}</div>
        </div>
      </div>
      <div className="spacer" />
      <Btn onClick={() => goTab("recipient")}>
        Смотреть желания <IconArrow size={20} />
      </Btn>
    </Item>
  );
}

function OrganizerBlock({ game }: { game: GameState }) {
  const { push, reloadGame, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const counts = game.families.map((f) => game.members.filter((m) => m.familyId === f.id).length);
  const equal = counts[0] === counts[1] && counts[0] > 0;

  const draw = async () => {
    const ok = await confirmDialog(
      `Провести жеребьёвку? В семьях по ${counts[0]} человек. После этого состав игры изменить будет нельзя, повторной жеребьёвки нет.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api("draw", { gameId: game.id });
      haptic.success();
      toast("Жеребьёвка проведена! Участники получили сообщение от бота.");
      await reloadGame();
    } catch (e) {
      haptic.error();
      toast((e as ApiError).message, "error");
      await reloadGame();
    } finally {
      setBusy(false);
    }
  };

  if (game.status === "drawn") {
    return (
      <Item style={{ marginBottom: 16 }}>
        <Btn className="secondary" onClick={() => push({ name: "organizer" })}>
          <IconCrown size={22} /> Панель организатора
        </Btn>
      </Item>
    );
  }

  return (
    <Item className="card" style={{ marginBottom: 16, position: "relative", overflow: "visible" }}>
      <Bells size={52} style={{ top: -30, right: 10 }} />
      <div className="row" style={{ marginBottom: 12 }}>
        <IconCrown size={22} />
        <b style={{ fontFamily: "var(--font-head)", textTransform: "uppercase", fontSize: 14 }}>Вы организатор</b>
      </div>
      <div className="balance">
        <div>
          <b>{counts[0]}</b>
          <span>{game.families[0]?.name}</span>
        </div>
        <span style={{ fontFamily: "var(--font-script)", fontSize: 28, color: "var(--accent)" }}>{equal ? "=" : "≠"}</span>
        <div>
          <b>{counts[1]}</b>
          <span>{game.families[1]?.name}</span>
        </div>
      </div>
      {game.inviteLink && (
        <>
          <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
            Ссылка-приглашение
          </div>
          <div className="invite">
            <span style={{ flex: 1 }}>{game.inviteLink}</span>
          </div>
          <div className="row" style={{ marginBottom: 12 }}>
            <Btn
              className="secondary compact"
              onClick={async () => toast((await copyText(game.inviteLink!)) ? "Ссылка скопирована" : "Не удалось скопировать", "ok")}
            >
              <IconCopy size={20} /> Копировать
            </Btn>
            <Btn
              className="secondary compact"
              onClick={() => shareLink(game.inviteLink!, `Присоединяйся к Тайному Санте «${game.name}»!`)}
            >
              <IconShare size={20} /> Поделиться
            </Btn>
          </div>
        </>
      )}
      <Btn disabled={!equal || busy} onClick={draw}>
        <IconShuffle size={22} /> {busy ? "Проводим…" : "Провести жеребьёвку"}
      </Btn>
      {!equal && (
        <p className="muted small center" style={{ margin: "8px 0 0" }}>
          {counts[0] === 0 && counts[1] === 0
            ? "Нужен хотя бы один участник в каждой семье."
            : `Чтобы начать, в семьях должно быть поровну участников (сейчас ${counts[0]} и ${counts[1]}).`}
        </p>
      )}
      <Btn className="ghost" onClick={() => push({ name: "organizer" })}>
        Участники и напоминания
      </Btn>
    </Item>
  );
}
