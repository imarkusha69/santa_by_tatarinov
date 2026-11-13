import { useEffect, useState } from "react";

// Файл заглушки (3:4, до 150 КБ). Пока его нет в /public, заглушка рисуется кодом.
const EMPTY_WISH_IMAGE = "/empty-wish.webp";

let probe: Promise<boolean> | null = null;
let probed: boolean | null = null;

/** Один запрос за сессию: есть ли готовая картинка заглушки. */
function hasEmptyImage(): Promise<boolean> {
  probe ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve((probed = img.naturalWidth > 0));
    img.onerror = () => resolve((probed = false));
    img.src = EMPTY_WISH_IMAGE;
  });
  return probe;
}

export function CoverPlaceholder({ pending = false, large = false }: { pending?: boolean; large?: boolean }) {
  const [useFile, setUseFile] = useState<boolean>(probed === true);
  useEffect(() => {
    if (probed === null) void hasEmptyImage().then(setUseFile);
  }, []);

  return (
    <div className={`cover-ph${large ? " large" : ""}${pending ? " pending" : ""}`} role="img" aria-label={pending ? "Ищем фото на странице" : "Фото появится позже"}>
      {useFile && !pending ? (
        <img src={EMPTY_WISH_IMAGE} alt="" draggable={false} />
      ) : (
        <>
          <svg
            width={large ? 72 : 44}
            height={large ? 72 : 44}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#E3B85A"
            strokeWidth={large ? 1.6 : 1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <rect x="3.5" y="8" width="17" height="4" rx="1" />
            <path d="M5 12v8h14v-8M12 8v12" />
            <path d="M12 8c-1.5-3-5-4-5-1.5C7 8 12 8 12 8zM12 8c1.5-3 5-4 5-1.5C17 8 12 8 12 8z" />
          </svg>
          <span>{pending ? "Ищем фото на странице…" : "Фото появится позже"}</span>
        </>
      )}
    </div>
  );
}
