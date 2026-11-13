-- Обложка желания: ручная (manual) > со страницы товара (auto) > заглушка (none).
-- Файлы лежат только у нас: bucket wish-covers, пути {wish_id}/manual.webp и {wish_id}/auto.webp.
-- Внешние ссылки на картинки не хранятся.

alter table public.wishes
  add column cover_source     text not null default 'none' check (cover_source in ('auto', 'manual', 'none')),
  add column cover_file_url   text,  -- путь показываемой обложки в wish-covers
  add column cover_auto_url   text,  -- путь копии фото со страницы товара
  add column cover_error      text check (cover_error is null or cover_error in
    ('invalid_url', 'blocked_host', 'robots_disallowed', 'timeout', 'not_html', 'no_image', 'too_large', 'download_failed')),
  add column cover_updated_at timestamptz,
  add constraint wishes_cover_consistent check (
    (cover_source = 'none' and cover_file_url is null)
    or (cover_source = 'manual' and cover_file_url = id::text || '/manual.webp')
    or (cover_source = 'auto' and cover_file_url = id::text || '/auto.webp' and cover_auto_url is not null)
  ),
  add constraint wishes_cover_auto_path check (cover_auto_url is null or cover_auto_url = id::text || '/auto.webp');

-- Ограничение частоты запросов к чужим сайтам (fetch-cover) на пользователя.
create table public.cover_fetches (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index cover_fetches_user_idx on public.cover_fetches (user_id, created_at desc);

alter table public.cover_fetches enable row level security;
revoke all on public.cover_fetches from anon, authenticated;

-- Закрытый bucket: читать можно только по подписанным ссылкам, которые API выдаёт
-- владельцу желания и его Санте. Политик для anon/authenticated нет.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wish-covers', 'wish-covers', false, 2097152, array['image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
