import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/app";
import { haptic } from "../lib/telegram";
import type { RecipientBrief } from "../lib/types";
import { Ornament, Star } from "../components/Decor";
import { IconArrow } from "../components/Icons";
import { Avatar, Btn, ErrorBox, Title } from "../components/ui";

// Печать гаснет 300 мс → клапан откидывается 600 мс → открытка выезжает с отскоком 900 мс → кнопка 600 мс
type Phase = "closed" | "seal" | "flap" | "card" | "done";
const T = { seal: 300, flap: 600, card: 900, done: 600 };
const CONFETTI_COLORS = ["#C21F2B", "#E3B85A", "#F7E9CC", "#0B2E22", "#FF5A4E"];

export function EnvelopeScreen() {
  const { game, gameId, reloadGame, replace, goTab } = useApp();
  const reduce = useReducedMotion();
  const alreadyOpened = !!game?.me.envelopeOpened;
  const [phase, setPhase] = useState<Phase>(alreadyOpened ? "done" : "closed");
  const [recipient, setRecipient] = useState<RecipientBrief | null>(game?.recipient ?? null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Повторный вход: анимация не показывается, сразу карточка получателя
  useEffect(() => {
    if (alreadyOpened && !recipient) {
      void api<RecipientBrief>("openEnvelope", { gameId }).then(setRecipient).catch(() => {});
    }
  }, [alreadyOpened, recipient, gameId]);

  const open = async () => {
    if (phase !== "closed") return;
    haptic.tap();
    setError(null);
    let r: RecipientBrief | null;
    try {
      r = await api<RecipientBrief>("openEnvelope", { gameId });
    } catch (e) {
      setError((e as ApiError).message);
      return;
    }
    setRecipient(r);
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const s = reduce ? 0.4 : 1;
    setPhase("seal");
    at(T.seal * s, () => setPhase("flap"));
    at((T.seal + T.flap) * s, () => setPhase("card"));
    at((T.seal + T.flap + T.card) * s, () => {
      setPhase("done");
      haptic.success();
      void reloadGame();
    });
  };

  const sealGone = phase !== "closed";
  const flapOpen = phase === "flap" || phase === "card" || phase === "done";
  const cardOut = phase === "card" || phase === "done";
  const showButton = phase === "done";

  return (
    <div className="screen no-nav">
      <Ornament tone="green" size={70} thread={60} style={{ top: -6, left: -10 }} dur={5.8} />
      <Ornament tone="cream" size={52} thread={110} style={{ top: -6, right: 20 }} dur={5.2} />
      <Star size={44} style={{ top: 140, right: -6 }} />
      <Title main="Твой" script="конверт" />
      {error && <ErrorBox message={error} onRetry={open} />}

      <div className="envelope-stage">
        <motion.div
          className="envelope"
          onClick={open}
          role="button"
          aria-label="Открыть конверт"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          whileTap={phase === "closed" ? { scale: 0.97 } : undefined}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ cursor: phase === "closed" ? "pointer" : "default" }}
        >
          <div className="env-back" />

          {/* открытка */}
          <motion.div
            className="env-card"
            initial={false}
            animate={{ y: cardOut ? "-62%" : "0%" }}
            transition={
              alreadyOpened
                ? { duration: 0 }
                : { type: "spring", duration: T.card / 1000, bounce: 0.45 }
            }
            style={{ zIndex: cardOut ? 7 : 2 }}
          >
            <div className="for">для тебя</div>
            {recipient && (
              <>
                <div style={{ marginTop: 8 }}>
                  <Avatar src={recipient.avatar} name={recipient.name} size={54} />
                </div>
                <div className="rname">{recipient.name}</div>
                <div className="muted small" style={{ color: "var(--ink-muted)" }}>
                  {recipient.familyName}
                </div>
              </>
            )}
          </motion.div>

          {/* передний карман */}
          <svg className="env-front" viewBox="0 0 145 100" preserveAspectRatio="none" aria-hidden>
            <path d="M0 100 L0 30 L72.5 70 L145 30 L145 100 Z" fill="#F7E9CC" />
            <path d="M0 30 L72.5 70 L145 30" fill="none" stroke="#E4D2A8" strokeWidth="1.2" />
          </svg>
          <div className="env-border" />

          {/* клапан */}
          <motion.div
            className="env-flap"
            initial={false}
            animate={{ rotateX: flapOpen ? 180 : 0 }}
            transition={alreadyOpened ? { duration: 0 } : { duration: T.flap / 1000, ease: [0.65, 0, 0.35, 1] }}
            style={{ zIndex: flapOpen ? 1 : 5 }}
          >
            <svg viewBox="0 0 145 58" preserveAspectRatio="none" aria-hidden>
              <path d="M0 0 L145 0 L72.5 56 Z" fill="#EBD8B0" stroke="#E4D2A8" strokeWidth="1" />
            </svg>
          </motion.div>

          {/* сургучная печать */}
          <AnimatePresence>
            {!sealGone && (
              <motion.svg
                className="env-seal"
                viewBox="0 0 64 64"
                initial={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ duration: T.seal / 1000 }}
                aria-hidden
              >
                <defs>
                  <radialGradient id="wax" cx="35%" cy="30%" r="75%">
                    <stop offset="0" stopColor="#d8323f" />
                    <stop offset="0.6" stopColor="#a5141f" />
                    <stop offset="1" stopColor="#5e0a11" />
                  </radialGradient>
                </defs>
                <path d="M32 3c5 0 7 3 11 4s8 0 10 4 0 7 2 11 5 6 4 10-4 6-5 10 1 8-3 11-8 1-12 3-6 5-10 5-6-3-10-5-9 0-12-3-1-7-3-11-5-6-5-10 3-6 4-10-1-8 2-11 7-2 11-4 6-4 11-4z" fill="url(#wax)" />
                <circle cx="32" cy="32" r="18" fill="none" stroke="#E3B85A" strokeWidth="1.8" opacity="0.85" />
                <text x="32" y="41" textAnchor="middle" fontFamily="Marck Script, cursive" fontSize="26" fill="#E3B85A">
                  С
                </text>
              </motion.svg>
            )}
          </AnimatePresence>

          {phase === "done" && !alreadyOpened && <Confetti />}
        </motion.div>

        <div style={{ minHeight: 140, width: "100%", marginTop: 28 }}>
          <AnimatePresence mode="wait">
            {phase === "closed" ? (
              <motion.p key="hint" className="center" style={{ color: "var(--accent-text)", opacity: 0.85 }} exit={{ opacity: 0 }}>
                Нажми на конверт, чтобы открыть
              </motion.p>
            ) : showButton ? (
              <motion.div
                key="cta"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: T.done / 1000, ease: [0.22, 1, 0.36, 1] }}
                className="stack"
              >
                <p className="center" style={{ margin: 0 }}>
                  Твой получатель: <b>{recipient?.name}</b>. Никому не говори!
                </p>
                <Btn className="gold" onClick={() => goTab("recipient")}>
                  Смотреть желания <IconArrow size={20} />
                </Btn>
                <Btn className="ghost" style={{ color: "var(--accent-text)" }} onClick={() => replace({ name: "tab", tab: "game" })}>
                  На главную
                </Btn>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
        const dist = 110 + Math.random() * 120;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 60,
          r: Math.random() * 540 - 270,
          c: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          d: 0.9 + Math.random() * 0.5,
        };
      }),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <motion.i
          key={i}
          style={{ background: p.c }}
          initial={{ x: 0, y: 0, rotate: 0, opacity: 1, scale: 0.6 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 140], rotate: p.r, opacity: [1, 1, 0], scale: 1 }}
          transition={{ duration: p.d * 1.6, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}
