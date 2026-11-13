import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/app";
import { confirmDialog, haptic, openLink } from "../lib/telegram";
import { PRIORITY_LABEL, type Wish } from "../lib/types";
import { IconClose, IconEdit, IconExternal, IconTrash } from "../components/Icons";
import { Btn, formatPrice } from "../components/ui";
import { PhotoCarousel } from "../components/WishCard";

const DETAIL_LABEL = { color: "Цвет", size: "Размер", model: "Модель" } as const;

export function WishPage({ wish: initial, owner }: { wish: Wish; owner: boolean }) {
  const { myWishes, setMyWishes, gameId, back, push, toast } = useApp();
  // Для владельца берём свежую версию из общего списка (после редактирования)
  const wish = (owner && myWishes?.find((w) => w.id === initial.id)) || initial;
  const [zoom, setZoom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const price = formatPrice(wish.price);
  const details = (Object.keys(DETAIL_LABEL) as (keyof typeof DETAIL_LABEL)[]).filter((k) => wish.details?.[k]);

  const remove = async () => {
    if (!(await confirmDialog("Удалить это желание?"))) return;
    setBusy(true);
    try {
      const r = await api<{ wishes: Wish[] }>("deleteWish", { gameId, wishId: wish.id });
      setMyWishes(r.wishes);
      haptic.success();
      toast("Желание удалено");
      back();
    } catch (e) {
      toast((e as ApiError).message, "error");
      setBusy(false);
    }
  };

  return (
    <div className="screen no-nav">
      <motion.div className="gallery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
        <PhotoCarousel photos={wish.photos} size="large" onTap={(i) => setZoom(i)} />
        <span className={`prio prio-${wish.priority}`} style={{ top: "calc(var(--top) + 12px)", left: 16, fontSize: 12 }}>
          {PRIORITY_LABEL[wish.priority]}
        </span>
      </motion.div>

      <motion.div
        className="wish-body"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.08 }}
      >
        {price && <div className="price">{price}</div>}
        <h1>{wish.title}</h1>
        {wish.shop && <div className="muted">{wish.shop}</div>}

        {owner && (
          <div className="row" style={{ marginTop: 16 }}>
            <Btn className="secondary compact" onClick={() => push({ name: "wishForm", wish })} disabled={busy}>
              <IconEdit size={20} /> Изменить
            </Btn>
            <Btn className="danger-ghost compact" onClick={remove} disabled={busy}>
              <IconTrash size={20} /> Удалить
            </Btn>
          </div>
        )}

        {details.length > 0 && (
          <div className="section">
            <h3>Детали</h3>
            {details.map((k) => (
              <div className="kv" key={k}>
                <span>{DETAIL_LABEL[k]}:</span>
                <b>{wish.details[k]}</b>
              </div>
            ))}
          </div>
        )}
        {wish.comment && (
          <div className="section">
            <h3>Комментарий</h3>
            <div className="pre">{wish.comment}</div>
          </div>
        )}
      </motion.div>

      {wish.url && (
        <div className="sticky-cta no-nav">
          <Btn onClick={() => openLink(wish.url!)}>
            Открыть в магазине <IconExternal size={20} />
          </Btn>
        </div>
      )}

      <AnimatePresence>
        {zoom !== null && wish.photos[zoom] && (
          <motion.div
            className="zoom"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setZoom(null)}
          >
            <motion.img
              src={wish.photos[zoom].large}
              alt=""
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.92 }}
              transition={{ duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
            />
            <button className="icon-btn close" aria-label="Закрыть" onClick={() => setZoom(null)}>
              <IconClose />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
