-- Тайный Санта для двух семей: схема данных.
-- Клиент НЕ ходит в таблицы напрямую: RLS включён везде и политик нет,
-- все запросы идут через Edge Function `api` с service role после проверки Telegram initData.

create extension if not exists pgcrypto;

create table public.users (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint not null unique,
  display_name  text not null check (char_length(display_name) between 1 and 64),
  avatar_url    text,               -- своё фото (путь в Storage), приоритетнее телеграмного
  tg_photo_url  text,               -- фото из Telegram (initData.user.photo_url)
  bio           text not null default '' check (char_length(bio) <= 300),
  created_at    timestamptz not null default now()
);

create table public.games (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 80),
  invite_code       text not null unique check (char_length(invite_code) >= 20),
  organizer_user_id uuid not null references public.users(id),
  status            text not null default 'open' check (status in ('open', 'drawn')),
  drawn_at          timestamptz,
  created_at        timestamptz not null default now()
);

create table public.families (
  id        uuid primary key default gen_random_uuid(),
  game_id   uuid not null references public.games(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 40),
  position  smallint not null check (position in (0, 1)),
  unique (game_id, position)
);

create table public.members (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  family_id           uuid not null references public.families(id),
  envelope_opened_at  timestamptz,
  santa_notified_at   timestamptz,  -- когда Санте последний раз сообщили об изменении желаний этого участника
  created_at          timestamptz not null default now(),
  unique (game_id, user_id)
);
create index members_family_idx on public.members (family_id);
create index members_user_idx on public.members (user_id);

create table public.assignments (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references public.games(id) on delete cascade,
  giver_member_id     uuid not null unique references public.members(id) on delete cascade,
  receiver_member_id  uuid not null unique references public.members(id) on delete cascade,
  check (giver_member_id <> receiver_member_id)
);
create index assignments_game_idx on public.assignments (game_id);

create table public.wishes (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  url         text check (url is null or char_length(url) <= 2000),
  price       numeric(12, 2) check (price is null or price >= 0),
  shop        text check (shop is null or char_length(shop) <= 80),
  priority    smallint not null default 2 check (priority between 1 and 3), -- 1 очень хочу, 2 хочу, 3 было бы приятно
  details     jsonb not null default '{}'::jsonb,                          -- {color, size, model}
  comment     text check (comment is null or char_length(comment) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index wishes_member_idx on public.wishes (member_id);

create table public.wish_photos (
  id         uuid primary key default gen_random_uuid(),
  wish_id    uuid not null references public.wishes(id) on delete cascade,
  file_url   text not null,  -- базовый путь в Storage; файлы лежат как <path>@480 и <path>@1280
  position   smallint not null check (position between 0 and 4),
  unique (wish_id, position)
);

create table public.messages (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  direction      text not null check (direction in ('santa_to_receiver', 'receiver_to_santa')),
  text           text not null check (char_length(text) between 1 and 2000),
  created_at     timestamptz not null default now(),
  delivered      boolean not null default false
);
create index messages_assignment_idx on public.messages (assignment_id, created_at);

-- Связь «сообщение бота в Telegram → пара», чтобы ответ реплаем в боте ушёл в нужный диалог.
create table public.bot_message_links (
  chat_id          bigint not null,
  message_id       bigint not null,
  assignment_id    uuid not null references public.assignments(id) on delete cascade,
  reply_direction  text not null check (reply_direction in ('santa_to_receiver', 'receiver_to_santa')),
  created_at       timestamptz not null default now(),
  primary key (chat_id, message_id)
);

-- ---------- Целостность состава игры ----------
-- Нельзя вступить в игру или сменить семью после жеребьёвки; семья должна быть из той же игры.
-- FOR SHARE ждёт завершения транзакции жеребьёвки, поэтому гонки «вступил во время жеребьёвки» нет.
create or replace function public.members_guard() returns trigger
language plpgsql as $$
declare
  v_status text;
  v_family_game uuid;
begin
  select status into v_status from public.games where id = new.game_id for share;
  if v_status <> 'open' then
    raise exception 'game_closed';
  end if;
  select game_id into v_family_game from public.families where id = new.family_id;
  if v_family_game is distinct from new.game_id then
    raise exception 'family_mismatch';
  end if;
  return new;
end $$;

create trigger members_guard_ins before insert on public.members
  for each row execute function public.members_guard();
create trigger members_guard_upd before update of family_id, game_id on public.members
  for each row execute function public.members_guard();

-- ---------- Жеребьёвка ----------
-- A = shuffle(семья А); B = shuffle(семья Б); круг = [A1, B1, ..., An, Bn];
-- дарит(круг[i]) = круг[(i+1) mod 2n]. Один раз, в одной транзакции, с проверкой результата.
create or replace function public.perform_draw(p_game_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_fa uuid;
  v_fb uuid;
  v_a uuid[];
  v_b uuid[];
  v_n int;
  v_total int;
  v_circle uuid[] := '{}';
  i int;
begin
  select status into v_status from games where id = p_game_id for update;
  if v_status is null then raise exception 'game_not_found'; end if;
  if v_status <> 'open' then raise exception 'already_drawn'; end if;

  select id into v_fa from families where game_id = p_game_id and position = 0;
  select id into v_fb from families where game_id = p_game_id and position = 1;

  -- gen_random_uuid() использует криптостойкий генератор
  select coalesce(array_agg(id order by gen_random_uuid()), '{}') into v_a from members where family_id = v_fa;
  select coalesce(array_agg(id order by gen_random_uuid()), '{}') into v_b from members where family_id = v_fb;

  v_n := cardinality(v_a);
  if v_n = 0 or v_n <> cardinality(v_b) then raise exception 'families_unequal'; end if;

  for i in 1..v_n loop
    v_circle := v_circle || v_a[i] || v_b[i];
  end loop;
  v_total := 2 * v_n;

  for i in 1..v_total loop
    insert into assignments (game_id, giver_member_id, receiver_member_id)
    values (p_game_id, v_circle[i], v_circle[(i % v_total) + 1]);
  end loop;

  -- Проверка: каждый ровно один раз дарит и получает, пары только между семьями.
  if (select count(distinct giver_member_id) from assignments where game_id = p_game_id) <> v_total
     or (select count(distinct receiver_member_id) from assignments where game_id = p_game_id) <> v_total
     or (select count(*) from members where game_id = p_game_id) <> v_total
     or exists (
       select 1 from assignments x
       join members g on g.id = x.giver_member_id
       join members r on r.id = x.receiver_member_id
       where x.game_id = p_game_id and g.family_id = r.family_id
     )
  then
    raise exception 'draw_verification_failed';
  end if;

  update games set status = 'drawn', drawn_at = now() where id = p_game_id;
  return v_total;
end $$;

-- ---------- Доступ ----------
alter table public.users             enable row level security;
alter table public.games             enable row level security;
alter table public.families          enable row level security;
alter table public.members           enable row level security;
alter table public.assignments       enable row level security;
alter table public.wishes            enable row level security;
alter table public.wish_photos       enable row level security;
alter table public.messages          enable row level security;
alter table public.bot_message_links enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on function public.perform_draw(uuid) from public, anon, authenticated;
revoke execute on function public.members_guard() from public, anon, authenticated;

-- ---------- Хранилище фото ----------
-- Публичное чтение по неугадываемому пути (uuid); запись только по подписанным URL от Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
