import { useEffect, useRef, useState } from "react";
import { api, ApiError, storage } from "../lib/api";
import { useApp } from "../lib/app";
import { haptic, lockClosing } from "../lib/telegram";
import { uploadAvatar } from "../lib/image";
import type { Profile } from "../lib/types";
import { Star } from "../components/Decor";
import { IconCamera } from "../components/Icons";
import { Avatar, Btn, Item, Stagger, Title } from "../components/ui";

export function ProfileScreen() {
  const { profile, setProfile, game, toast, reloadGame } = useApp();
  const draftKey = "draft:profile";
  const [name, setName] = useState(() => storage.get<{ name: string; bio: string }>(draftKey)?.name ?? profile.name);
  const [bio, setBio] = useState(() => storage.get<{ name: string; bio: string }>(draftKey)?.bio ?? profile.bio);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty = name !== profile.name || bio !== profile.bio;
  useEffect(() => {
    if (dirty) storage.set(draftKey, { name, bio });
    else storage.remove(draftKey);
  }, [name, bio, dirty]);
  useEffect(() => (dirty ? lockClosing() : undefined), [dirty]);

  const family = game?.families.find((f) => f.id === game.me.familyId);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const p = await api<Profile>("updateProfile", { displayName: name, bio });
      setProfile(p);
      setName(p.name);
      setBio(p.bio);
      storage.remove(draftKey);
      haptic.success();
      toast("Профиль сохранён");
      void reloadGame();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const changeAvatar = async (file: File | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    try {
      const path = await uploadAvatar(file);
      const p = await api<Profile>("updateProfile", { avatar: path });
      setProfile(p);
      haptic.success();
      void reloadGame();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setAvatarBusy(false);
    }
  };

  const resetAvatar = async () => {
    setAvatarBusy(true);
    try {
      setProfile(await api<Profile>("updateProfile", { avatar: "telegram" }));
      void reloadGame();
    } catch (e) {
      toast((e as ApiError).message, "error");
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="screen">
      <Star size={54} style={{ top: 10, right: 14 }} />
      <Stagger>
        <Title main="Мой" script="профиль" />
        <Item className="profile-photo">
          <div style={{ position: "relative", opacity: avatarBusy ? 0.5 : 1 }}>
            <Avatar src={profile.avatar} name={name || profile.name} size={112} />
            <button
              className="icon-btn"
              aria-label="Загрузить фото"
              style={{ position: "absolute", right: -6, bottom: -6, background: "var(--accent)", color: "var(--accent-text)", borderRadius: "50%", border: "3px solid var(--pine)" }}
              onClick={() => fileRef.current?.click()}
              disabled={avatarBusy}
            >
              <IconCamera size={22} />
            </button>
          </div>
          {profile.avatarSource === "custom" && profile.tgAvatar && (
            <button className="link-btn small" onClick={resetAvatar} disabled={avatarBusy}>
              Вернуть фото из Telegram
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void changeAvatar(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </Item>

        <Item>
          <label className="field">
            <span>Имя в игре</span>
            <input className="input" maxLength={64} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Коротко о себе</span>
            <textarea
              className="input"
              maxLength={300}
              rows={4}
              placeholder="Что любите, чем увлекаетесь, чего точно не надо дарить"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
            <div className="counter muted">{bio.length} / 300</div>
          </label>
          <div className="field">
            <span>Семья</span>
            <div className="glass" style={{ padding: "14px 16px" }}>
              <b>{family?.name ?? "…"}</b>
              <div className="muted small">Сменить семью может только организатор до жеребьёвки.</div>
            </div>
          </div>
          <Btn disabled={!dirty || !name.trim() || busy} onClick={save}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </Btn>
        </Item>
      </Stagger>
    </div>
  );
}
