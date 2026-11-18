import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, photoUrl, storage } from "../lib/api";
import { useApp } from "../lib/app";
import { haptic, lockClosing } from "../lib/telegram";
import { uploadWishPhoto } from "../lib/image";
import { COVER_HINT, fetchCover, normalizeUserUrl, uploadManualCover, type CoverUrls } from "../lib/cover";
import { PRIORITY_LABEL, type CoverReason, type CoverSource, type Priority, type Wish } from "../lib/types";
import { IconCamera, IconClose, IconImage, IconLink } from "../components/Icons";
import { Btn, Item, Stagger, Title } from "../components/ui";
import { CoverPlaceholder } from "../components/CoverPlaceholder";

interface PhotoSlot {
  key: string;
  base?: string; // путь в хранилище после загрузки
  preview: string;
  uploading: boolean;
}

/** Состояние обложки в форме. Автофото действительно только для той ссылки, с которой взято. */
interface CoverState {
  source: CoverSource;
  hasAuto: boolean;
  autoForUrl: string | null;
  error: CoverReason | null;
  errorForUrl: string | null;
}

interface Draft {
  id: string;
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
  cover: CoverState;
}

interface Previews {
  manual: string | null;
  auto: string | null;
}

const MAX_EXTRA = 4; // + обложка = 5 фото
const COVER_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";

function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function fromWish(w: Wish | undefined, id: string): Draft {
  const url = normalizeUserUrl(w?.url ?? "");
  const c = w?.cover;
  return {
    id,
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
    cover: {
      source: c?.source ?? "none",
      hasAuto: !!c?.autoUrl,
      autoForUrl: c?.autoUrl ? url : null,
      error: c?.error ?? null,
      errorForUrl: c?.error ? url : null,
    },
  };
}

const fieldsOnly = ({ cover: _c, ...rest }: Draft) => JSON.stringify(rest);

export function WishForm({ wish }: { wish?: Wish }) {
  const { gameId, setMyWishes, reloadMyWishes, fetchCoverInBackground, back, toast } = useApp();
  const draftKey = `draft:wish:${gameId}:${wish?.id ?? "new"}`;
  const saved = storage.get<{ draft: Draft; previews: Previews }>(draftKey);
  const [initialId] = useState(() => wish?.id ?? (saved?.draft?.id && saved.draft.cover ? saved.draft.id : newId()));
  const original = useMemo(() => fromWish(wish, initialId), [wish, initialId]);

  const [f, setF] = useState<Draft>(() => (saved?.draft?.cover ? saved.draft : original));
  const [previews, setPreviews] = useState<Previews>(
    () =>
      saved?.previews ?? {
        manual: wish?.cover.source === "manual" ? wish.cover.url : null,
        auto: wish?.cover.autoUrl ?? null,
      },
  );
  const [slots, setSlots] = useState<PhotoSlot[]>(() =>
    f.photos.map((base) => ({ key: base, base, preview: photoUrl(`${base}@480`), uploading: false })),
  );
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  const draft: Draft = useMemo(() => ({ ...f, photos: slots.filter((s) => s.base).map((s) => s.base!) }), [f, slots]);
  // У сохранённого желания смена обложки записывается сразу, поэтому несохранёнными считаем только поля.
  const dirty =
    fieldsOnly(draft) !== fieldsOnly(original) || (!wish && JSON.stringify(draft.cover) !== JSON.stringify(original.cover));

  useEffect(() => {
    if (dirty) storage.set(draftKey, { draft, previews });
    else storage.remove(draftKey);
  }, [draft, previews, dirty, draftKey]);
  useEffect(() => (dirty ? lockClosing() : undefined), [dirty]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }));
  const setCover = (patch: Partial<CoverState>) => setF((p) => ({ ...p, cover: { ...p.cover, ...patch } }));

  // ---------- производные состояния обложки ----------
  const urlNorm = normalizeUserUrl(f.url);
  const urlLooksOk = !urlNorm || /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(urlNorm);
  const autoReady = !!urlNorm && f.cover.hasAuto && f.cover.autoForUrl === urlNorm;
  const effSource: CoverSource = f.cover.source === "auto" && !autoReady ? "none" : f.cover.source;
  const shown =
    effSource === "manual" ? (localPreview ?? previews.manual) : effSource === "auto" ? previews.auto : null;
  const knownError = urlNorm && f.cover.error && f.cover.errorForUrl === urlNorm ? f.cover.error : null;
  const hint: CoverReason | null = effSource === "none" ? (!urlLooksOk ? "invalid_url" : knownError) : null;

  const afterPersist = (r: CoverUrls) => {
    setPreviews((p) => ({ manual: r.manualUrl ?? p.manual, auto: r.autoUrl ?? p.auto }));
    if (r.saved) void reloadMyWishes();
  };

  // ---------- действия ----------
  const refreshFromPage = async () => {
    if (!urlNorm || fetching) return;
    if (!urlLooksOk) {
      setCover({ error: "invalid_url", errorForUrl: urlNorm });
      return;
    }
    setFetching(true);
    try {
      const r = await fetchCover(urlNorm, f.id);
      if (r.status === "ok") {
        haptic.success();
        setPreviews((p) => ({ ...p, auto: r.preview_url ?? p.auto }));
        setF((p) => ({
          ...p,
          cover: {
            source: p.cover.source === "manual" ? "manual" : "auto",
            hasAuto: true,
            autoForUrl: urlNorm,
            error: null,
            errorForUrl: null,
          },
        }));
        if (f.cover.source === "manual") toast("Фото со страницы найдено. Ваше фото осталось обложкой.");
        if (wish) void reloadMyWishes();
      } else {
        haptic.error();
        setCover({ error: r.reason, errorForUrl: urlNorm });
      }
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setFetching(false);
    }
  };

  const uploadCover = async (file: File | undefined) => {
    if (!file) return;
    const local = URL.createObjectURL(file);
    setCoverBusy(true);
    try {
      const r = await uploadManualCover(file, f.id, gameId);
      afterPersist(r);
      setCover({ source: "manual" });
      setLocalPreview(r.manualUrl ? null : local);
      haptic.success();
    } catch (e) {
      haptic.error();
      toast((e as ApiError).message, "error");
    } finally {
      setCoverBusy(false);
    }
  };

  const switchCover = async (source: "auto" | "manual") => {
    setCoverBusy(true);
    try {
      const r = await api<CoverUrls>("setCover", { gameId, wishId: f.id, source });
      afterPersist(r);
      setCover({ source });
      haptic.select();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setCoverBusy(false);
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = Math.max(0, MAX_EXTRA - slots.length);
    const list = Array.from(files).slice(0, room);
    if (files.length > room) toast(`Можно добавить не больше ${MAX_EXTRA} дополнительных фото`, "error");
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

  const uploading = slots.some((s) => s.uploading) || coverBusy;
  const valid = f.title.trim().length > 0 && !uploading;

  const save = async () => {
    if (!valid) return;
    if (!urlLooksOk) {
      toast(COVER_HINT.invalid_url, "error");
      return;
    }
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
          id: f.id,
          title: f.title,
          url: f.url,
          price,
          shop: f.shop,
          priority: f.priority,
          details: { color: f.color, size: f.size, model: f.model },
          comment: f.comment,
          photos: slots.map((s) => s.base).filter(Boolean),
          cover: { source: effSource, hasAuto: autoReady, error: knownError },
        },
      });
      storage.remove(draftKey);
      setMyWishes(r.wishes, wish ? undefined : r.id);
      // Один раз при сохранении со ссылкой, если фото с этой страницы ещё не пробовали брать.
      // Желание уже сохранено: ошибка автоподгрузки ничего не блокирует.
      if (urlNorm && !autoReady && !knownError) {
        fetchCoverInBackground(r.id, urlNorm, effSource === "none");
      }
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
            <span>Обложка</span>
            <div className="cover-edit">
              <div className="frame">
                {shown ? <img src={shown} alt="Обложка" /> : <CoverPlaceholder pending={fetching} />}
                {(coverBusy || (fetching && shown)) && <div className="busy skel" />}
                {shown && <span className="badge-src">{effSource === "manual" ? "Своё фото" : "Со страницы"}</span>}
              </div>
              <div className="cover-actions">
                <Btn className="secondary" disabled={coverBusy} onClick={() => coverRef.current?.click()}>
                  <IconCamera size={20} /> Загрузить фото
                </Btn>
                {urlNorm && (
                  <Btn className="secondary" disabled={fetching || coverBusy} onClick={refreshFromPage}>
                    <IconLink size={20} /> {fetching ? "Ищем фото…" : "Обновить фото"}
                  </Btn>
                )}
                {autoReady && effSource !== "auto" && (
                  <Btn className="secondary" disabled={coverBusy} onClick={() => switchCover("auto")}>
                    <IconImage size={20} /> Взять фото со страницы
                  </Btn>
                )}
                {(previews.manual || localPreview) && effSource === "auto" && (
                  <Btn className="ghost" disabled={coverBusy} onClick={() => switchCover("manual")}>
                    Вернуть своё фото
                  </Btn>
                )}
                <span className="muted small">JPG, PNG, WebP или HEIC до 10 МБ, обрежется до 3:4.</span>
              </div>
            </div>
            <input
              ref={coverRef}
              type="file"
              accept={COVER_ACCEPT}
              hidden
              onChange={(e) => {
                void uploadCover(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>

          <label className="field">
            <span>Название *</span>
            <input className="input" maxLength={120} placeholder="Например, шерстяной плед" value={f.title} onChange={(e) => set("title", e.target.value)} />
          </label>
          <div className="field">
            <label>
              <span style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Ссылка на товар</span>
              <input
                className="input"
                type="url"
                inputMode="url"
                maxLength={2000}
                placeholder="https://"
                value={f.url}
                onChange={(e) => set("url", e.target.value)}
                onBlur={() => urlNorm && !urlLooksOk && setCover({ error: "invalid_url", errorForUrl: urlNorm })}
              />
            </label>
            {hint ? (
              <div className="cover-hint" role="status">
                <p>{COVER_HINT[hint]}</p>
                {hint !== "invalid_url" && hint !== "blocked_host" && (
                  <Btn className="secondary" disabled={coverBusy} onClick={() => coverRef.current?.click()}>
                    Загрузить фото
                  </Btn>
                )}
              </div>
            ) : (
              urlNorm &&
              effSource === "none" &&
              !fetching && (
                <div className="cover-hint info">
                  <p>Фото со страницы подтянется при сохранении.</p>
                </div>
              )
            )}
          </div>

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

          <div className="field">
            <span>Ещё фото (до {MAX_EXTRA})</span>
            <div className="photos-edit">
              {slots.map((s) => (
                <div className="photo-tile" key={s.key}>
                  {s.preview ? <img src={s.preview} alt="" /> : null}
                  {s.uploading && <div className="busy skel" />}
                  <button className="remove" aria-label="Убрать фото" onClick={() => setSlots((x) => x.filter((y) => y.key !== s.key))}>
                    <IconClose size={18} />
                  </button>
                </div>
              ))}
              {slots.length < MAX_EXTRA && (
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
