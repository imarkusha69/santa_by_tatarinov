// Обёртка над Telegram.WebApp: все вызовы безопасны на старых клиентах и вне Telegram.

/* eslint-disable @typescript-eslint/no-explicit-any */
const W: any = (window as any).Telegram?.WebApp;

export const inTelegram = !!W?.initData;
export const initData: string = W?.initData ?? "";

const supports = (v: string): boolean => {
  try {
    return !!W?.isVersionAtLeast?.(v);
  } catch {
    return false;
  }
};
const safe = (fn: () => void) => {
  try {
    fn();
  } catch {
    /* старый клиент: метод недоступен */
  }
};

function applyInsets() {
  const root = document.documentElement.style;
  const s = W?.safeAreaInset ?? {};
  const c = W?.contentSafeAreaInset ?? {};
  root.setProperty("--tg-top", `${(s.top ?? 0) + (c.top ?? 0)}px`);
  root.setProperty("--tg-bottom", `${(s.bottom ?? 0) + (c.bottom ?? 0)}px`);
  root.setProperty("--tg-left", `${(s.left ?? 0) + (c.left ?? 0)}px`);
  root.setProperty("--tg-right", `${(s.right ?? 0) + (c.right ?? 0)}px`);
}

export function initTelegram() {
  if (!W) return;
  safe(() => W.ready());
  safe(() => W.expand());
  if (supports("8.0")) {
    safe(() => W.requestFullscreen());
    safe(() => W.lockOrientation());
  }
  if (supports("7.7")) safe(() => W.disableVerticalSwipes());
  // Боту нужно право писать в личку: уведомления и анонимный чат
  const u = W.initDataUnsafe?.user;
  if (u && !u.allows_write_to_pm && supports("6.9")) safe(() => W.requestWriteAccess());
  applyInsets();
  for (const ev of ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged", "viewportChanged"]) {
    safe(() => W.onEvent(ev, applyInsets));
  }
}

export type Chrome = "green" | "red" | "cream";
const CHROME: Record<Chrome, string> = { green: "#0B2E22", red: "#8E0F1A", cream: "#F7E9CC" };

/** Шапка и нижняя панель Telegram под фон экрана. */
export function setChrome(c: Chrome) {
  const color = CHROME[c];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  if (!W) return;
  if (supports("6.1")) {
    safe(() => W.setHeaderColor(color));
    safe(() => W.setBackgroundColor(color));
  }
  if (supports("7.10")) safe(() => W.setBottomBarColor(c === "cream" ? CHROME.cream : CHROME.green));
}

export const haptic = {
  tap: () => supports("6.1") && safe(() => W.HapticFeedback.impactOccurred("light")),
  select: () => supports("6.1") && safe(() => W.HapticFeedback.selectionChanged()),
  success: () => supports("6.1") && safe(() => W.HapticFeedback.notificationOccurred("success")),
  error: () => supports("6.1") && safe(() => W.HapticFeedback.notificationOccurred("error")),
};

let closingLocks = 0;
/** Подтверждение закрытия, пока есть несохранённые данные. Возвращает функцию снятия. */
export function lockClosing(): () => void {
  closingLocks++;
  if (closingLocks === 1 && supports("6.2")) safe(() => W.enableClosingConfirmation());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    closingLocks--;
    if (closingLocks === 0 && supports("6.2")) safe(() => W.disableClosingConfirmation());
  };
}

let backHandler: (() => void) | null = null;
const onBack = () => backHandler?.();
if (W && supports("6.1")) safe(() => W.BackButton.onClick(onBack));

export function setBackButton(handler: (() => void) | null) {
  backHandler = handler;
  if (!W || !supports("6.1")) return;
  safe(() => (handler ? W.BackButton.show() : W.BackButton.hide()));
}

export function openLink(url: string) {
  if (W?.openLink) safe(() => W.openLink(url));
  else window.open(url, "_blank", "noopener");
}

export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (W?.openTelegramLink) safe(() => W.openTelegramLink(share));
  else window.open(share, "_blank", "noopener");
}

export function confirmDialog(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (W && supports("6.2")) {
      try {
        W.showConfirm(message, (ok: boolean) => resolve(!!ok));
        return;
      } catch {
        /* fallthrough */
      }
    }
    resolve(window.confirm(message));
  });
}

export function startParam(): string | null {
  return W?.initDataUnsafe?.start_param ?? new URLSearchParams(location.search).get("tgWebAppStartParam");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
