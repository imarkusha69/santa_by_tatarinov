import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, storage, useQuery } from "./lib/api";
import { Ctx, useApp, type AppCtx, type ChatSide, type Route, type Tab } from "./lib/app";
import { inTelegram, setBackButton, setChrome, startParam, type Chrome } from "./lib/telegram";
import type { GameState, MeResponse, Profile, Wish } from "./lib/types";
import { Snow } from "./components/Decor";
import { IconChat, IconGift, IconHeart, IconTree, IconUser } from "./components/Icons";
import { ErrorBox, Skeleton } from "./components/ui";
import { Lobby } from "./screens/Lobby";
import { GameScreen } from "./screens/Game";
import { WishesScreen } from "./screens/Wishes";
import { WishPage } from "./screens/WishPage";
import { WishForm } from "./screens/WishForm";
import { RecipientScreen } from "./screens/Recipient";
import { ChatScreen } from "./screens/Chat";
import { ProfileScreen } from "./screens/Profile";
import { EnvelopeScreen } from "./screens/Envelope";
import { OrganizerScreen, OrganizerChat } from "./screens/Organizer";

const LAST_GAME = "lastGame";

export function App() {
  const me = useQuery<MeResponse>(inTelegram ? "me" : null, () => api<MeResponse>("me"), { cache: false });
  const [gameId, setGameId] = useState<string | null>(null);
  const [lobbyForced, setLobbyForced] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "error"; id: number } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const showToast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    setToast({ msg, kind, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // Выбор игры: по ссылке-приглашению, иначе последняя открытая, иначе единственная.
  useEffect(() => {
    const d = me.data;
    if (!d) return;
    setProfile(d.user);
    if (gameId || lobbyForced) return;
    if (d.invite?.isMember) return setGameId(d.invite.gameId);
    if (d.invite && d.invite.status === "open") return; // экран вступления
    const last = storage.get<string>(LAST_GAME);
    if (last && d.games.some((g) => g.id === last)) return setGameId(last);
    if (d.games.length === 1) return setGameId(d.games[0].id);
  }, [me.data, gameId, lobbyForced]);

  useEffect(() => {
    if (gameId) storage.set(LAST_GAME, gameId);
  }, [gameId]);

  let content: JSX.Element;
  if (!inTelegram) {
    content = <OpenInTelegram />;
  } else if (!me.data || !profile) {
    content = me.error ? (
      <div className="screen no-nav">
        <ErrorBox message={me.error.message} onRetry={me.reload} />
      </div>
    ) : (
      <BootSkeleton />
    );
  } else if (gameId) {
    content = (
      <GameShell
        key={gameId}
        gameId={gameId}
        profile={profile}
        setProfile={setProfile}
        toast={showToast}
        toLobby={() => {
          setLobbyForced(true);
          setGameId(null);
          void me.reload();
        }}
      />
    );
  } else {
    content = (
      <Lobby
        me={me.data}
        invite={lobbyForced ? null : me.data.invite}
        onOpen={(id) => {
          setGameId(id);
          setLobbyForced(false);
        }}
        toast={showToast}
        startCode={startParam()}
      />
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      {content}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast ${toast.kind === "error" ? "error" : ""}`}
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.25 }}
            role="status"
            onClick={() => setToast(null)}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function OpenInTelegram() {
  useEffect(() => setChrome("green"), []);
  return (
    <div className="app bg-green">
      <Snow />
      <div className="screen no-nav">
        <h1 className="title">
          <span className="t-main">Тайный</span>
          <span className="t-script">Санта</span>
        </h1>
        <p className="muted">Это приложение работает внутри Telegram. Откройте его по ссылке-приглашению от организатора.</p>
      </div>
    </div>
  );
}

function BootSkeleton() {
  useEffect(() => setChrome("green"), []);
  return (
    <div className="app bg-green">
      <div className="screen no-nav">
        <Skeleton h={44} w="60%" />
        <div className="spacer" />
        <Skeleton h={50} w="45%" />
        <div className="spacer" />
        <Skeleton h={180} r={20} />
        <div className="spacer" />
        <Skeleton h={180} r={20} />
      </div>
    </div>
  );
}

// ---------- оболочка игры: навигация, данные игры, нижнее меню ----------

const NAV_KEY = (id: string) => `nav:${id}`;
const NAV_TTL = 1000 * 60 * 60 * 6;

function bgFor(route: Route): Chrome {
  switch (route.name) {
    case "envelope":
    case "organizer":
    case "orgChat":
      return "red";
    case "wish":
    case "wishForm":
      return "cream";
    case "tab":
      return route.tab === "wishes" ? "cream" : "green";
  }
}

function GameShell(props: {
  gameId: string;
  profile: Profile;
  setProfile: (p: Profile) => void;
  toast: AppCtx["toast"];
  toLobby: () => void;
}) {
  const { gameId } = props;
  const game = useQuery<GameState>(`game:${gameId}`, () => api<GameState>("game", { gameId }), { cache: true });
  const wishes = useQuery<{ wishes: Wish[] }>(`wishes:${gameId}`, () => api("myWishes", { gameId }), { cache: true });
  const [lastAddedWish, setLastAdded] = useState<string | null>(null);

  // Восстановление экрана после сворачивания / перезапуска
  const [stack, setStack] = useState<Route[]>(() => {
    const saved = storage.get<{ at: number; stack: Route[] }>(NAV_KEY(gameId));
    if (saved && Date.now() - saved.at < NAV_TTL && saved.stack.length) return saved.stack;
    return [{ name: "tab", tab: "game" }];
  });
  useEffect(() => {
    storage.set(NAV_KEY(gameId), { at: Date.now(), stack });
  }, [stack, gameId]);

  const route = stack[stack.length - 1];
  const dirRef = useRef(1);

  const push = useCallback((r: Route) => {
    dirRef.current = 1;
    setStack((s) => [...s, r]);
  }, []);
  const back = useCallback(() => {
    dirRef.current = -1;
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);
  const replace = useCallback((r: Route) => {
    dirRef.current = 1;
    setStack((s) => [...s.slice(0, -1), r]);
  }, []);
  const goTab = useCallback((tab: Tab, side?: ChatSide) => {
    dirRef.current = 0;
    setStack([{ name: "tab", tab, side }]);
  }, []);

  // Системная кнопка «Назад»
  useEffect(() => {
    setBackButton(stack.length > 1 ? back : null);
  }, [stack.length, back]);
  useEffect(() => () => setBackButton(null), []);

  const bg = bgFor(route);
  useEffect(() => setChrome(bg), [bg]);

  const ctx = useMemo<AppCtx>(
    () => ({
      gameId,
      game: game.data,
      gameError: game.error,
      reloadGame: game.reload,
      profile: props.profile,
      setProfile: props.setProfile,
      myWishes: wishes.data?.wishes ?? null,
      myWishesError: wishes.error,
      setMyWishes: (w, added) => {
        wishes.setData({ wishes: w });
        if (added) setLastAdded(added);
      },
      reloadMyWishes: wishes.reload,
      lastAddedWish,
      route,
      push,
      back,
      goTab,
      replace,
      toast: props.toast,
      toLobby: props.toLobby,
    }),
    [gameId, game.data, game.error, game.reload, props, wishes, lastAddedWish, route, push, back, goTab, replace],
  );

  const showNav = route.name === "tab";
  const routeKey = `${stack.length}:${route.name}:${route.name === "tab" ? route.tab : ""}`;
  const dir = dirRef.current;

  return (
    <Ctx.Provider value={ctx}>
      <div className={`app bg-${bg}`}>
        {bg !== "cream" && <Snow />}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={routeKey}
            style={{ position: "absolute", inset: 0 }}
            initial={{ opacity: 0, x: dir * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -24 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <RouteView route={route} />
          </motion.div>
        </AnimatePresence>
        {showNav && <BottomNav />}
      </div>
    </Ctx.Provider>
  );
}

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case "tab":
      switch (route.tab) {
        case "game":
          return <GameScreen />;
        case "wishes":
          return <WishesScreen />;
        case "recipient":
          return <RecipientScreen />;
        case "chat":
          return <ChatScreen initialSide={route.side} />;
        case "profile":
          return <ProfileScreen />;
      }
      return null;
    case "wish":
      return <WishPage wish={route.wish} owner={route.owner} />;
    case "wishForm":
      return <WishForm wish={route.wish} />;
    case "envelope":
      return <EnvelopeScreen />;
    case "organizer":
      return <OrganizerScreen />;
    case "orgChat":
      return <OrganizerChat assignmentId={route.assignmentId} title={route.title} />;
  }
}

const TABS: { tab: Tab; label: string; Icon: typeof IconTree }[] = [
  { tab: "game", label: "Игра", Icon: IconTree },
  { tab: "wishes", label: "Желания", Icon: IconHeart },
  { tab: "recipient", label: "Получатель", Icon: IconGift },
  { tab: "chat", label: "Чат", Icon: IconChat },
  { tab: "profile", label: "Профиль", Icon: IconUser },
];

function BottomNav() {
  const { route, goTab, game, myWishes } = useApp();
  const active = route.name === "tab" ? route.tab : null;
  return (
    <nav className="nav" aria-label="Разделы">
      {TABS.map(({ tab, label, Icon }) => {
        const badge =
          (tab === "recipient" && game?.status === "drawn" && !game.me.envelopeOpened) ||
          (tab === "wishes" && myWishes !== null && myWishes.length === 0);
        return (
          <motion.button
            key={tab}
            className={active === tab ? "on" : ""}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.12 }}
            onClick={() => active !== tab && goTab(tab)}
            aria-current={active === tab ? "page" : undefined}
          >
            <Icon size={24} />
            {label}
            {badge && <span className="badge" />}
          </motion.button>
        );
      })}
    </nav>
  );
}
