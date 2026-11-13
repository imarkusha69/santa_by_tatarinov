import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, photoUrl, storage } from "../lib/api";
import { useApp } from "../lib/app";
import { haptic, lockClosing } from "../lib/telegram";
import { uploadWishPhoto } from "../lib/image";
import { PRIORITY_LABEL, type Priority, type Wish } from "../lib/types";
import { IconCamera, IconClose } from "../components/Icons";
import { Btn, Item, Stagger, Title } from "../components/ui";

interface PhotoSlot {
  key: string;
  base?: string; // путь в хранилище после загрузки
  preview: string;
  uploading: boolean;
}

interface Draft {
  title: string;
  url: string;
  price: string;
  shop: string;
  priority: Priority;
  color: string;
  size: string;
  model: string;
  comment: string;
  photos: string[];
}

const MAX_PHOTOS = 5;

function fromWish(w?: Wish): Draft {
  return {
    title: w?.title ?? "",
    url: w?.url ?? "",
    price: w?.price != null ? String(w.price) : "",
    shop: w?.shop ?? "",
    priority: w?.priority ?? 2,
    color: w?.details?.color ?? "",
    size: w?.details?.size ?? "",
    model: w?.details?.model ?? "",
    comment: w?.comment ?? "",
    photos: (w?.photos ?? []).map((p) => p.base),
  };
}

export function WishForm({ wish }: { wish?: Wish }) {
  const { gameId, setMyWishes, back, toast } = useApp();
  const draftKey = `draft:wish:${gameId}:${wish?.id ?? "new"}`;
  const original = useMemo(() => JSON.stringify(fromWish(wish)), [wish]);
  const [f, setF] = useState<Draft>(() => storage.get<Draft>(draftKey) ?? fromWish(wish));
  const [slots, setSlots] = useState<PhotoSlot[]>(() =>
    f.photos.map((base) => ({ key: base, base, preview: photoUrl(`${base}@480`), uploading: false })),
  );
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const draft: Draft = useMemo(
    () => ({ ...f, photos: slots.filter((s) => s.base).map((s) => s.base!) }),
    [f, slots],
  );
  const dirty = JSON.stringify(draft) !== original;

  // Черновик в локальном хранилище + подтверждение закрытия
  useEffect(() => {
    if (dirty) storage.set(draftKey, draft);
    else storage.remove(draftKey);
  }, [draft, dirty, draftKey]);
  useEffect(() => (dirty ? lockClosing() : undefined), [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_PHOTOS - slots.length;
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast(`Можно добавить не больше ${MAX_PHOTOS} фото`, "error");
    const added: PhotoSlot[] = list.map((file) => ({
      key: `${file.name}-${Math.random()}`,
      preview: URL.createObjectURL(file),
      uploading: true,
    }));
    setSlots((s) => [...s, ...added]);
    await Promise.all(
      list.map(async (file, i) => {
        const key = added[i].key;
        try {
          const base = await uploadWishPhoto(file);
          setSlots((s) => s.map((x) => (x.key === key ? { ...x, base, uploading: false } : x)));
        } catch (e) {
          toast((e as ApiError).message ?? "Не удалось загрузить фото", "error");
          setSlots((s) => s.filter((x) => x.key !== key));
        }
      }),
    );
  };

  const uploading = slots.some((s) => s.uploading);
  const valid = f.title.trim().length > 0 && !uploading;

  const save = async () => {
    if (!valid) return;
    const price = f.price.trim() ? Number(f.price.replace(/\s/g, "").replace(",", ".")) : null;
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      toast("Проверьте цену: только число", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ id: string; wishes: Wish[] }>("saveWish", {
        gameId,
        wish: {
          id: wish?.id,
          title: f.title,
          url: f.url,
          price,
          shop: f.shop,
          priority: f.priority,
          details: { color: f.color, size: f.size, model: f.model },
          comment: f.comment,
          photos: slots.map((s) => s.base).filter(Boolean),
        },
      });
      storage.remove(draftKey);
      setMyWishes(r.wishes, wish ? undefined : r.id);
      haptic.success();
      toast(wish ? "Изменения сохранены" : "Желание добавлено");
      back();
    } catch (e) {
      haptic.error();
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen no-nav">
      <Stagger>
        <Title main={wish ? "Изменить" : "Новое"} script="желание" small />

        <Item>
          <div className="field">
            <span>Фото (до {MAX_PHOTOS})</span>
            <div className="photos-edit">
              {slots.map((s, i) => (
                <div className="photo-tile" key={s.key}>
                  {s.preview ? <img src={s.preview} alt="" /> : null}
                  {s.uploading && <div className="busy skel" />}
                  {i === 0 && <span className="first">Обложка</span>}
                  <button
                    className="remove"
                    aria-label="Убрать фото"
                    onClick={() => setSlots((x) => x.filter((y) => y.key !== s.key))}
                  >
                    <IconClose size={18} />
                  </button>
                </div>
              ))}
              {slots.length < MAX_PHOTOS && (
                <button className="photo-add" onClick={() => fileRef.current?.click()}>
                  <IconCamera size={28} />
                  Добавить
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <label className="field">
            <span>Название *</span>
            <input className="input" maxLength={120} placeholder="Например, шерстяной плед" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <label className="field">
            <span>Ссылка на товар</span>
            <input className="input" type="url" inputMode="url" maxLength={2000} placeholder="https://" value={f.url} onChange={(e) => set("url", e.target.value)} />
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Цена, ₽</span>
              <input className="input" inputMode="decimal" maxLength={14} placeholder="Необязательно" value={f.price} onChange={(e) => set("price", e.target.value.replace(/[^\d.,\s]/g, ""))} />
            </label>
            <label className="field">
              <span>Магазин или бренд</span>
              <input className="input" maxLength={80} value={f.shop} onChange={(e) => set("shop", e.target.value)} />
            </label>
          </div>

          <div className="field">
            <span>Приоритет</span>
            <div className="seg">
              {([1, 2, 3] as Priority[]).map((p) => (
                <button
                  key={p}
                  className={`${f.priority === p ? "on" : ""} p${p}`}
                  onClick={() => {
                    haptic.select();
                    set("priority", p);
                  }}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Детали</span>
            <div className="grid-2">
              <input className="input" maxLength={60} placeholder="Цвет" value={f.color} onChange={(e) => set("color", e.target.value)} />
              <input className="input" maxLength={60} placeholder="Размер" value={f.size} onChange={(e) => set("size", e.target.value)} />
            </div>
            <div style={{ height: 12 }} />
            <input className="input" maxLength={60} placeholder="Модель" value={f.model} onChange={(e) => set("model", e.target.value)} />
          </div>

          <label className="field">
            <span>Комментарий</span>
            <textarea className="input" maxLength={1000} rows={4} placeholder="Что важно знать Санте" value={f.comment} onChange={(e) => set("comment", e.target.value)} />
          </label>
        </Item>
      </Stagger>

      <div className="sticky-cta no-nav">
        <Btn disabled={!valid || busy} onClick={save}>
          {busy ? "Сохраняем…" : uploading ? "Загружаем фото…" : wish ? "Сохранить" : "Добавить желание"}
        </Btn>
      </div>
    </div>
  );
}
