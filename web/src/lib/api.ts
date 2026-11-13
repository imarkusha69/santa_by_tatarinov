import { useCallback, useEffect, useRef, useState } from "react";
import { initData } from "./telegram";

const API_URL = import.meta.env.VITE_API_URL as string;

/** Публичный URL фото в Supabase Storage (тот же проект, что и функции). */
export function photoUrl(path: string): string {
  try {
    return `${new URL(API_URL).origin}/storage/v1/object/public/photos/${path}`;
  } catch {
    return "";
  }
}

const ERRORS: Record<string, string> = {
  network: "Нет соединения. Проверьте интернет и попробуйте ещё раз.",
  unauthorized: "Откройте приложение из Telegram, чтобы войти.",
  game_not_found: "Игра не найдена. Проверьте ссылку-приглашение.",
  game_closed: "Жеребьёвка уже проведена, вход в игру закрыт.",
  not_member: "Вы не участник этой игры.",
  not_organizer: "Это действие доступно только организатору.",
  families_unequal: "В семьях должно быть поровну участников.",
  already_drawn: "Жеребьёвка уже проведена.",
  not_drawn: "Жеребьёвка ещё не проведена.",
  too_long: "Слишком длинный текст.",
  bad_price: "Проверьте цену.",
  too_many_wishes: "Желаний слишком много: не больше 50.",
  wish_not_found: "Желание не найдено, возможно, оно уже удалено.",
  upload: "Не удалось загрузить фото. Попробуйте ещё раз.",
};

export class ApiError extends Error {
  constructor(public code: string) {
    super(ERRORS[code] ?? "Что-то пошло не так. Попробуйте ещё раз.");
  }
}

export async function api<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json", "x-init-data": initData },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new ApiError("network");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error ?? "server");
  return data as T;
}

// ---------- локальный кэш ----------

export const storage = {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* квота или приватный режим */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/**
 * Загрузка с кэшем: сразу показываем закэшированное, затем обновляем с сервера.
 * key=null — запрос не выполняется.
 */
export function useQuery<T>(key: string | null, fetcher: () => Promise<T>, opts: { cache?: boolean; poll?: number } = {}) {
  const cacheKey = key && opts.cache ? `cache:${key}` : null;
  const [data, setDataState] = useState<T | null>(() => (cacheKey ? storage.get<T>(cacheKey) : null));
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!!key);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const setData = useCallback(
    (v: T | null) => {
      setDataState(v);
      if (cacheKey && v) storage.set(cacheKey, v);
    },
    [cacheKey],
  );

  const reload = useCallback(async () => {
    if (!key) return;
    setLoading(true);
    try {
      const v = await fetcherRef.current();
      setData(v);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("server"));
    } finally {
      setLoading(false);
    }
  }, [key, setData]);

  useEffect(() => {
    setDataState(cacheKey ? storage.get<T>(cacheKey) : null);
    void reload();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!opts.poll || !key) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void fetcherRef.current().then(setData).catch(() => {});
    }, opts.poll);
    return () => clearInterval(t);
  }, [opts.poll, key, setData]);

  return { data, error, loading, reload, setData };
}

/** Загрузка уже сжатого файла по подписанному URL Supabase Storage. */
export async function uploadBlob(signedUrl: string, blob: Blob) {
  let res: Response;
  try {
    res = await fetch(signedUrl, {
      method: "PUT",
      headers: { "content-type": blob.type, "x-upsert": "false", "cache-control": "max-age=31536000" },
      body: blob,
    });
  } catch {
    throw new ApiError("network");
  }
  if (!res.ok) throw new ApiError("upload");
}
