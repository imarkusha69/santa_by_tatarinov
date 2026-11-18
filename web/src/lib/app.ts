import { createContext, useContext } from "react";
import type { ApiError } from "./api";
import type { GameState, Profile, Wish } from "./types";

export type Tab = "game" | "wishes" | "recipient" | "chat" | "profile";
export type ChatSide = "santa" | "receiver";

export type Route =
  | { name: "tab"; tab: Tab; side?: ChatSide }
  | { name: "wish"; wish: Wish; owner: boolean }
  | { name: "wishForm"; wish?: Wish }
  | { name: "envelope" }
  | { name: "organizer" }
  | { name: "orgChat"; assignmentId: string; title: string };

export interface AppCtx {
  gameId: string;
  game: GameState | null;
  gameError: ApiError | null;
  reloadGame: () => Promise<void>;
  profile: Profile;
  setProfile: (p: Profile) => void;
  myWishes: Wish[] | null;
  myWishesError: ApiError | null;
  setMyWishes: (w: Wish[], addedId?: string) => void;
  reloadMyWishes: () => Promise<void>;
  lastAddedWish: string | null;
  /** Желания, для которых сейчас идёт автоподгрузка обложки. */
  coverPending: Set<string>;
  /** Автоподгрузка в фоне после сохранения: не блокирует, по итогу обновляет список. */
  fetchCoverInBackground: (wishId: string, url: string, notifyOnError: boolean) => void;
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  goTab: (tab: Tab, side?: ChatSide) => void;
  replace: (r: Route) => void;
  toast: (msg: string, kind?: "ok" | "error") => void;
  toLobby: () => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("no app context");
  return c;
}
