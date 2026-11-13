import { motion, type HTMLMotionProps, type Variants } from "motion/react";
import { useState, type ReactNode } from "react";
import { haptic } from "../lib/telegram";

/** Кнопка: сжатие до 0.97 за 120 мс и лёгкий тактильный отклик. */
export function Btn({ onClick, className = "", ...rest }: HTMLMotionProps<"button">) {
  return (
    <motion.button
      type="button"
      whileTap={rest.disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className={`btn ${className}`}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

export function Tap({ onClick, className = "", ...rest }: HTMLMotionProps<"button">) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.12 }}
      className={className}
      onClick={(e) => {
        haptic.tap();
        onClick?.(e);
      }}
      {...rest}
    />
  );
}

/** Заголовок капсом + рукописное слово внахлёст со сдвигом вправо. */
export function Title({ main, script, small }: { main: string; script: string; small?: boolean }) {
  return (
    <motion.h1 variants={item} className={`title${small ? " small" : ""}`}>
      <span className="t-main">{main}</span>
      <span className="t-script">{script}</span>
    </motion.h1>
  );
}

export function Avatar({ src, name, size = 44 }: { src: string | null | undefined; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        (name.trim()[0] ?? "?").toUpperCase()
      )}
    </span>
  );
}

// Появление снизу по очереди: 600 мс, шаг 80 мс, ease-out
export const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
export const item: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={list} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}

export function Item({ children, className, ...rest }: HTMLMotionProps<"div">) {
  return (
    <motion.div variants={item} className={className} {...rest}>
      {children}
    </motion.div>
  );
}

export function Skeleton({ h = 20, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skel" style={{ height: h, width: w, borderRadius: r }} />;
}

export function Empty({ art, title, text, children }: { art?: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <motion.div variants={item} className="empty">
      {art && <div className="art">{art}</div>}
      <h3>{title}</h3>
      {text && <p className="muted">{text}</p>}
      {children && <div style={{ marginTop: 20 }}>{children}</div>}
    </motion.div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <div>{message}</div>
      {onRetry && (
        <button className="link-btn" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

export function formatPrice(p: number | null): string | null {
  if (p === null || p === undefined) return null;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(p)} ₽`;
}

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Сегодня";
  if (d.toDateString() === y.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? formatTime(iso) : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
