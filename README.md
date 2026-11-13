# Тайный Санта для двух семей

Telegram mini app: две семьи, жеребьёвка по кругу `A1→B1→A2→B2→…→An→Bn→A1`, списки желаний в виде товарных карточек, анонимный чат через бота, панель организатора.

```
web/                      React + TypeScript + Vite + Motion (mini app)
supabase/migrations/      схема Postgres, жеребьёвка perform_draw(), RLS, бакет фото
supabase/functions/api    API mini app (проверка initData на каждый запрос)
supabase/functions/bot    вебхук бота: /start и ответы в анонимном чате
supabase/functions/fetch-cover   обложка желания со страницы товара
supabase/functions/cover-upload  серверная конвертация своей обложки (HEIC и старые браузеры)
```

## Как устроена безопасность

- Клиент не обращается к таблицам напрямую: RLS включён на всех таблицах, политик нет, права `anon`/`authenticated` отозваны. Все данные отдаёт функция `api` (service role) после проверки подписи Telegram `initData`.
- «Мой получатель» определяется на сервере по `giver_member_id` текущего пользователя. Id получателя от клиента не принимается.
- Пары и все чаты отдаются только если `games.organizer_user_id` совпадает с текущим пользователем. Проверка выполняется при каждом запросе.
- Жеребьёвка выполняется функцией `perform_draw()` в одной транзакции: блокировка игры (`FOR UPDATE`), криптостойкое перемешивание (`gen_random_uuid()`), проверка результата. Триггер на `members` закрывает вход и смену семьи после жеребьёвки.
- Фото загружаются по подписанным URL в бакет `photos`. Лимит 3 МБ, только WebP/JPEG/PNG, пути с UUID. Перед загрузкой фото сжимаются на клиенте до 480 и 1280 px.
- Код приглашения: 24 случайных символа.

## Запуск

### 1. Бот и mini app в @BotFather

1. `/newbot` — получить токен.
2. `/newapp` — создать mini app у этого бота. Короткое имя, например `app`, URL — адрес, где будет размещён `web/` (шаг 4).
3. Ссылка-приглашение будет вида `https://t.me/<bot>/<app>?startapp=<код>`.

### 2. Supabase

```bash
supabase link --project-ref <ref>
supabase db push
supabase secrets set \
  TELEGRAM_BOT_TOKEN=<токен> \
  TELEGRAM_BOT_USERNAME=<имя_бота_без_@> \
  TELEGRAM_APP_SHORT_NAME=app \
  TELEGRAM_WEBHOOK_SECRET=<случайная_строка> \
  APP_ORIGIN=https://<домен-mini-app>
supabase functions deploy api --no-verify-jwt
supabase functions deploy bot --no-verify-jwt
supabase functions deploy fetch-cover --no-verify-jwt
supabase functions deploy cover-upload --no-verify-jwt
```

### 3. Вебхук бота

```bash
curl "https://api.telegram.org/bot<токен>/setWebhook" \
  -d url=https://<ref>.supabase.co/functions/v1/bot \
  -d secret_token=<TELEGRAM_WEBHOOK_SECRET> \
  -d 'allowed_updates=["message"]'
```

### 4. Фронтенд

```bash
cd web
cp .env.example .env   # VITE_API_URL=https://<ref>.supabase.co/functions/v1/api
npm install
npm run build          # dist/ → любой статический хостинг (Vercel, Netlify, Cloudflare Pages)
```

## Обложка желания

Источник обложки по приоритету: своё фото (`manual`) → фото со страницы товара (`auto`) → заглушка (`none`).
Файлы лежат только у нас, в закрытом bucket `wish-covers`: `{wish_id}/manual.webp` и `{wish_id}/auto.webp`.
Внешние ссылки на картинки не хранятся, это запрещено ограничением в базе. Показ идёт по подписанным
ссылкам (24 ч), которые API выдаёт только владельцу желания и его Санте.

**Автоподгрузка** (`POST /functions/v1/fetch-cover`, `{ url, wishId }`). Вызывается при сохранении желания
со ссылкой, если с этой страницы фото ещё не брали, и по кнопке «Обновить фото». По расписанию не запускается.
- Разрешены только http/https и порты 80/443. Хост проверяется по IP после DNS: localhost, 127/8, 10/8,
  172.16/12, 192.168/16, 169.254/16, 100.64/10, ::1, fc00::/7, fe80::/10, IPv4 внутри IPv6 и т. п.
  Проверка повторяется на каждом редиректе (не больше 3) и для адреса картинки.
- Таймаут 5 с. Страница: только `text/html`, до 2 МБ, читается потоком. Картинка: только JPEG/PNG/WebP,
  до 5 МБ, формат сверяется по сигнатуре файла.
- robots.txt по RFC 9309 для User-Agent `SantaCoverBot`: если путь запрещён или robots.txt отвечает 5xx,
  возвращается `robots_disallowed`.
- Источники: `og:image:secure_url` / `og:image` → `twitter:image` → `link rel=image_src` → JSON-LD `Product.image`.
- Обрезка по центру до 3:4, 800 px, WebP q80 (ImageMagick WASM).
- Не больше 30 обращений за 10 минут на пользователя.

**Своё фото**: JPG, PNG, WebP или HEIC до 10 МБ. Браузер обрезает фото до 3:4, уменьшает до 1200 px и
сохраняет в WebP 0.85. Если браузер не может прочитать файл (HEIC на Android) или не умеет кодировать WebP,
то же делает функция `cover-upload`.

**Заглушка**: файл `web/public/empty-wish.webp` (3:4, до 150 КБ), если он есть. Если нет, заглушка
рисуется кодом.

## Проверки

```bash
# подпись initData, защита fetch-cover, robots.txt, разбор HTML, обработка картинок
deno test --allow-net --allow-read --allow-env supabase/functions/_shared/
# типы функций
deno check supabase/functions/*/index.ts
# типы и сборка фронтенда (бандл ≈107 КБ gzip)
cd web && npm run build
```

## Что ещё нужно от дизайна

Ёлочные шары, подарок, колокольчики и звезда сейчас сделаны векторными заглушками в палитре, с бархатной фактурой (`web/src/components/Decor.tsx`). Готовые 3D-рендеры (WebP/AVIF 2x/3x, до 150 КБ) кладутся в `web/public/objects/` и подставляются вместо SVG в тех же компонентах. Анимации качания и парения при этом сохраняются.

## Известные ограничения v1

- Бот может написать участнику, только если тот разрешил ему писать. Приложение запрашивает это при первом запуске (`requestWriteAccess`). Если доступа нет, сообщение остаётся в чате приложения с пометкой «не доставлено» (её видит организатор).
- Новые сообщения в чате подтягиваются опросом раз в 5 секунд, без realtime.
- Фото, загруженные в форму, но не сохранённые в желании, остаются в хранилище.
