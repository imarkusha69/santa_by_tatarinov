import { useEffect, useState } from "react";
import { api, ApiError, storage } from "../lib/api";
import { lockClosing, setChrome, haptic } from "../lib/telegram";
import type { InvitePreview, MeResponse } from "../lib/types";
import { GiftBox, Ornament, Snow } from "../components/Decor";
import { IconArrow, IconCrown, IconLock } from "../components/Icons";
import { Btn, Item, Stagger, Tap, Title } from "../components/ui";

interface Props {
  me: MeResponse;
  invite: InvitePreview | null;
  onOpen: (gameId: string) => void;
  toast: (m: string, k?: "ok" | "error") => void;
  startCode: string | null;
}

export function Lobby({ me, invite, onOpen, toast }: Props) {
  useEffect(() => setChrome("green"), []);
  const [mode, setMode] = useState<"list" | "create">(me.games.length ? "list" : "create");

  return (
    <div className="app bg-green">
      <Snow />
      <div className="screen no-nav">
        <Ornament tone="red" size={70} thread={60} style={{ top: -10, right: 18 }} />
        <Ornament tone="cream" size={50} thread={100} style={{ top: -10, right: 96 }} dur={6} />
        <Stagger>
          <Title main="Тайный" script="Санта" />
          {invite && invite.status === "open" && !invite.isMember ? (
            <Join invite={invite} onOpen={onOpen} toast={toast} />
          ) : invite && invite.status === "drawn" && !invite.isMember ? (
            <Item className="card">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <IconLock />
                <div>
                  <b>Вход в «{invite.name}» закрыт</b>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>
                    Жеребьёвка уже проведена, состав игры больше не меняется.
                  </p>
                </div>
              </div>
            </Item>
          ) : null}

          {mode === "list" && (
            <>
              {me.games.length > 0 && (
                <Item>
                  <h2 className="h2">Мои игры</h2>
                  <div className="stack">
                    {me.games.map((g) => (
                      <Tap key={g.id} className="card" style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12 }} onClick={() => onOpen(g.id)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800 }}>{g.name}</div>
                          <div className="muted small">
                            {g.status === "open" ? "Набор участников" : "Жеребьёвка проведена"}
                            {g.isOrganizer && " · вы организатор"}
                          </div>
                        </div>
                        <IconArrow />
                      </Tap>
                    ))}
                  </div>
                </Item>
              )}
              <Item>
                <div className="spacer" />
                <Btn className="secondary" onClick={() => setMode("create")}>
                  <IconCrown size={22} /> Создать новую игру
                </Btn>
              </Item>
            </>
          )}
          {mode === "create" && (
            <CreateGame
              onCreated={onOpen}
              toast={toast}
              onCancel={me.games.length ? () => setMode("list") : undefined}
              hasInvite={!!invite && invite.status === "open" && !invite.isMember}
            />
          )}
        </Stagger>
        <GiftBox size={92} style={{ bottom: 18, right: -20, position: "fixed" }} />
      </div>
    </div>
  );
}

function Join({ invite, onOpen, toast }: { invite: InvitePreview; onOpen: (id: string) => void; toast: Props["toast"] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const join = async (familyId: string) => {
    setBusy(familyId);
    try {
      const r = await api<{ gameId: string }>("joinGame", { code: invite.code, familyId });
      haptic.success();
      onOpen(r.gameId);
    } catch (e) {
      haptic.error();
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Item className="card">
      <div className="muted small">Вас пригласили в игру</div>
      <div style={{ fontFamily: "var(--font-head)", fontSize: 20, textTransform: "uppercase", margin: "4px 0 16px" }}>{invite.name}</div>
      <b>Из какой вы семьи?</b>
      <p className="muted small" style={{ margin: "4px 0 12px" }}>
        Семья выбирается один раз. Если ошиблись, организатор сможет перенести вас до жеребьёвки.
      </p>
      <div className="stack">
        {invite.families.map((f) => (
          <Btn key={f.id} className={f.position === 0 ? "" : "gold"} disabled={!!busy} onClick={() => join(f.id)}>
            {busy === f.id ? "Вступаем…" : f.name}
            <span style={{ opacity: 0.75, fontWeight: 600 }}>· {f.count}</span>
          </Btn>
        ))}
      </div>
    </Item>
  );
}

const DRAFT = "draft:createGame";

function CreateGame({
  onCreated,
  toast,
  onCancel,
  hasInvite,
}: {
  onCreated: (id: string) => void;
  toast: Props["toast"];
  onCancel?: () => void;
  hasInvite: boolean;
}) {
  const initial = storage.get<{ name: string; a: string; b: string; my: 0 | 1 }>(DRAFT) ?? { name: "", a: "", b: "", my: 0 as 0 | 1 };
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = !!(f.name || f.a || f.b);

  useEffect(() => {
    storage.set(DRAFT, f);
  }, [f]);
  useEffect(() => (dirty ? lockClosing() : undefined), [dirty]);

  const valid = f.name.trim() && f.a.trim() && f.b.trim();
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const r = await api<{ gameId: string }>("createGame", { name: f.name, familyA: f.a, familyB: f.b, myFamily: f.my });
      storage.remove(DRAFT);
      haptic.success();
      onCreated(r.gameId);
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Item>
      <h2 className="h2">{hasInvite ? "Или создайте свою игру" : "Новая игра"}</h2>
      <p className="muted" style={{ marginTop: -4 }}>
        Две семьи, поровну участников. Каждый дарит одному человеку из другой семьи.
      </p>
      <label className="field">
        <span>Название игры</span>
        <input className="input" maxLength={80} placeholder="Новый год 2027" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Первая семья</span>
          <input className="input" maxLength={40} placeholder="Ивановы" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} />
        </label>
        <label className="field">
          <span>Вторая семья</span>
          <input className="input" maxLength={40} placeholder="Петровы" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} />
        </label>
      </div>
      <div className="field">
        <span>Я из семьи</span>
        <div className="switch">
          {[0, 1].map((i) => (
            <button key={i} className={f.my === i ? "on" : ""} onClick={() => setF({ ...f, my: i as 0 | 1 })}>
              {(i === 0 ? f.a : f.b) || (i === 0 ? "Первая" : "Вторая")}
            </button>
          ))}
          <span className="thumb" style={{ width: "calc(50% - 4px)", left: f.my === 0 ? 4 : "50%", top: 4, bottom: 4, right: "auto", transition: "left 250ms ease-out" }} />
        </div>
      </div>
      <Btn disabled={!valid || busy} onClick={submit}>
        {busy ? "Создаём…" : "Создать игру"}
      </Btn>
      {onCancel && (
        <Btn className="ghost" onClick={onCancel}>
          Отмена
        </Btn>
      )}
    </Item>
  );
}
