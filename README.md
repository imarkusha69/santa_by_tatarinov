# Тайный Санта для двух семей

Telegram mini app: две семьи, жеребьёвка по кругу `A1→B1→A2→B2→…→An→Bn→A1`, списки желаний в виде товарных карточек, анонимный чат через бота, панель организатора.

```
web/                      React + TypeScript + Vite + Motion (mini app)
supabase/migrations/      схема Postgres, жеребьёвка perform_draw(), RLS, бакет фото
supabase/functions/api    API mini app (проверка initData на каждый запрос)
supabase/functions/bot    вебхук бота: /start и ответы в анонимном чате
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

## Проверки

```bash
# подпись initData
deno test --allow-env supabase/functions/_shared/telegram_test.ts
# типы функций
deno check supabase/functions/api/index.ts supabase/functions/bot/index.ts
# типы и сборка фронтенда (бандл ≈105 КБ gzip)
cd web && npm run build
```

## Что ещё нужно от дизайна

Ёлочные шары, подарок, колокольчики и звезда сейчас сделаны векторными заглушками в палитре, с бархатной фактурой (`web/src/components/Decor.tsx`). Готовые 3D-рендеры (WebP/AVIF 2x/3x, до 150 КБ) кладутся в `web/public/objects/` и подставляются вместо SVG в тех же компонентах. Анимации качания и парения при этом сохраняются.

## Известные ограничения v1

- Бот может написать участнику, только если тот разрешил ему писать. Приложение запрашивает это при первом запуске (`requestWriteAccess`). Если доступа нет, сообщение остаётся в чате приложения с пометкой «не доставлено» (её видит организатор).
- Новые сообщения в чате подтягиваются опросом раз в 5 секунд, без realtime.
- Фото, загруженные в форму, но не сохранённые в желании, остаются в хранилище.
