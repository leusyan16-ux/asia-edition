# Етап 9 — локальна інтеграція PostgreSQL

Оновлення: [етап 10 підключив CSV/JSON UI та приватні локальні фотографії](POSTGRES_UPLOAD_MEDIA.md). Обмеження upload/media, наведені нижче, є історичним станом етапу 9.

2026-10-18. Чинні `CATALOG_SCALE.md` і `PRODUCTION_CATALOG.md` використано як основу. Реальний Supabase, міграції хмари, Klook, бронювання й оплата не використовувалися. `.env.local` не змінено. Типовий вибір джерела не змінено: `postgres` працює лише за явною конфігурацією.

## Реалізація

Новий `catalog_projection.documents` — SQL read model у чинному форматі `AdminTour`/`Tour`, а не другий туристичний продукт або новий сайт. Посилання `source_id`/`source_revision` пов'язують його з приватним ingestion workspace. Імпорт не записує в чинні normalized `public.tours`; Supabase adapter та його RPC збережені. Це свідоме розділення: застосунок може читати SQL-проєкцію без підміни public RPC та без видавання worker прав адміністратора.

Trigger `project_source` працює в тій самій транзакції, що source products/checkpoint. Новий запис стає чернеткою. При повторному імпорті редакційні поля проєкції зберігаються, facts/commercial snapshot оновлюються; публікація знімається, verification очищується, readiness блокується. При незмінних fingerprint/lifecycle зберігаються права й editorial approvals; зміна джерела повертає їх до перевірки. Не покладатися на UUID чи slug як на зовнішню ідентичність: dedup лишається provider + external_product_id.

`projectionRepository` виконує SQL-фільтрацію країни/напрямку/категорії, RU/EN substring search, тривалості, валюти й перевірених/чинних цін, сортування та paging. У Node повертається лише сторінка. Окремі generated columns прибирають повторне розпакування великого document для пошуку/статистики. Строки й значення параметризовані; SQL sort є кодовим whitelist. RU/EN структура, усі 13 країн і demo route збережені.

Публічний reader має RLS тільки published + visible + не archived + verified/demo. Видача проходить `localTourPayload`/`tourSchema`, metadata джерела не потрапляє в public payload. Browser anon/authenticated не отримали доступу до schemas. Reader/editor/worker — серверні NOLOGIN ролі; це не Supabase browser JWT roles. Для future login DBA має окремо надати потрібне членство. Private preview вимагає чинну локальну admin-сесію.

Адмінпанель `/admin` використовує SQL-пагінацію по 25 рядків, SQL stats і country counts. `/admin/tours/<uuid>` відкриває стандартний редактор; `/admin/tours/<uuid>/preview?locale=ru|en` — захищений шаблон. `saveProjection` перевіряє updatedAt під row lock, зберігає пакет транзакційно та пише аудит. Source metadata не можна змінити через звичайне збереження (TS + SQL trigger). Застарілий editor після worker refresh отримує conflict.

`/admin/import?page=N` показує PostgreSQL jobs/statuses/checkpoint/retry/errors і журнал пакетів, `/admin/api/postgres` — захищений JSON GET. POST цього endpoint підтримує review із RBAC/CSRF, optimistic timestamp та HTTPS rights evidence; він ніколи не публікує запис. Приклад payload:

```json
{"action":"review","id":"<product UUID>","expected":"<updatedAt з редактора>","editorial":"pending","rights":"unknown","evidence":null}
```

Старі JSON import endpoints у postgres-режимі відмовляють, щоб випадково не записати в `.admin-local`. Їхня поведінка у старому режимі незмінна. CSV/JSON upload UI не перенаправлено в новий worker: для PostgreSQL наразі підготовлений окремий streaming CLI; інтерфейс цього етапу — перегляд jobs/logs і редагування карток. Review UI не додано; захищений review endpoint підготовлено.

## Локальний запуск без зовнішніх доступів

У PowerShell **для поточної сесії**, без редагування `.env.local`:

```powershell
$env:ADMIN_MODE='local'
$env:TOUR_DATA_SOURCE='postgres'
$env:POSTGRES_LOCAL_PROFILE='development'
$env:POSTGRES_LOCAL_WORKER='off'
pnpm dev --hostname 127.0.0.1
```

На першому зверненні створюється **нова окрема локальна** `.admin-postgres/development`. Міграції 001–004 → worker role file → 005 виконуються тільки у вбудованому PostgreSQL. Наявний `.admin-local` не копіюється й не змінюється. Новий каталог спочатку порожній — це очікувано. `ADMIN_LOCAL_DIRECTORY` лишається чинним місцем локальної admin identity; за потреби виберіть уже налаштований профіль. Якщо identity ще немає, штатний `pnpm admin:setup` створює власний локальний обліковий запис без зовнішніх API.

Адреси:

- `http://127.0.0.1:3000/admin/login`
- `http://127.0.0.1:3000/admin`
- `http://127.0.0.1:3000/admin/import`
- `http://127.0.0.1:3000/ru/tours` і `/en/tours`

Для повернення старого JSON-каталогу: зупинити сервер, встановити `TOUR_DATA_SOURCE=local`, перезапустити. Для повернення попереднього demo/supabase режиму відновити попереднє значення. Значення у `.env.local` автоматично не переписувалися. Після зміни профілю/адаптера потрібен restart.

Потоковий імпорт **лише погодженого нормалізованого локального файлу**, коли Next зупинений:

```powershell
node --import tsx scripts/postgres-local-import.ts <profile> <normalized.ndjson> <manifest.json>
```

Manifest — чинний feed scope `{provider,countries,snapshot_at,complete:false}`. NDJSON: один чинний `ExternalImportRecord` на рядок, не довільний формат API Klook. Для тестів лише окремі `test-*`/`qa-*` профілі, `test_data:true` і назви TEST/ТЕСТ. CLI використовує 50 записів / до 4 MiB за пакет, зберігає source identity, не публікує. Переконатися, що web та CLI не відкрили той самий embedded profile одночасно. Автоматичного backfill/mass import наявних даних немає; 26 пілотних карток не переносилися.

## Worker, supervisor та pool

Загальний `stageStream` збережений; додано optional batchSize 1..250, типовий 250. Пакети локального CLI — 50: вимірювання показали, що довга транзакція 250 в single-process PGlite блокує читання. Це не зміна dedup/checkpoint алгоритму.

`startSupervisor` має унікального owner, AbortController, bounded polling, error callback; `stop()` чекає поточний атомарний пакет. `attachShutdown` підготовлено для SIGINT/SIGTERM та завершення pool/embedded DB. Після рестарту worker використовує SQL checkpoint, lease expiration і fencing. Перетини provider/country scopes, rollback та retries успадковані від етапу 8. CLI запускає worker одразу; опційний in-process локальний supervisor вмикається `POSTGRES_LOCAL_WORKER=on` після першого звернення до PostgreSQL-режиму. Він не є daemon/service і зупиняється разом із Next. За замовчуванням off.

Встановлено `pg` та `@types/pg`. `createLoopbackPostgresPool` — справжній lazy pg Pool із max=4 (межі 1..20), connection timeout 5 с, idle 30 с, statement timeout 45 с та idle-in-transaction timeout 60 с. Через transactional wrapper є BEGIN/COMMIT/ROLLBACK і release у finally. Функція не читає env і не створює connection до першого запиту. **Жоден native pool не підключався до PostgreSQL-сервера**; перевірені лише factory/lifecycle/rollback з fake driver і lazy close без connect. Runtime сайту використовує PGlite.

Будь-який remote URL ця фабрика зараз відхиляє. Для майбутнього production потрібні окремо погоджений native runtime adapter, TLS, restricted server logins для reader/editor/worker, host allowlist, secret manager та process supervisor/container. Підготовка pool не є підтвердженням підключення Supabase.

## Локальні перевірки

Автотести: SQL/public adapter parity із чинним `selectTours`, verified prices перед filters, locale search, pagination, RLS, source immutability, review permissions/evidence, publication blocked, збереження editorial approvals, stale editor, фізичне закриття/reopen persistent DB із продовженням checkpoint, supervisor stop і pool rollback/close. Існуючі 26 тестів також мають проходити без зміни очікувань.

HTTP harness `scripts/verify-postgres-http.ts`: власні `.admin-postgres/test-stage9-http-*` і `.admin-local/test-stage9-http-*`, localhost:3012. Логін, anonymous denial, CSRF denial, RU/EN каталог і private preview, source draft 404, edit/save, jobs/logs та блокування legacy importer. Профілі й тестовий Next output видаляються тільки після перевірки абсолютних шляхів; зміни Next-generated QA includes прибираються. Пілот перевіряється SHA-256. Результат — `data/benchmarks/stage9/http-smoke.json`.

Load harness `scripts/benchmark-postgres-integration.ts <1000|5000|10000|12500>`: на кожен обсяг окремий процес/ефемерна БД, N імпортованих чернеток + N незалежних published TEST fixtures для meaningful public reads. **Ці public fixtures не є імпортованими продуктами і не потрапляють до робочого каталогу.** Чотири конкурентні async клієнти, по 40 вимірів кожного методу разом із worker. Метрики — adapter latency, не HTTP/LCP. PGlite серіалізує запити всередині однієї БД; це не тест незалежних pg connections чи production throughput. RSS включає весь embedded PostgreSQL, його проєкції та fixtures. JSON містять p50/p95/max, sampled RSS, помилки й imported_published=0.

Початкові результати перед generated-field optimization: `before-projection-fields-*.json`; із полями та пакетом 250: `batch-250-*.json`; фінальний локальний пакет 50: `integration-*.json`. Перший batch-250 цикл частково працював паралельно з HTTP smoke; це не контрольований A/B benchmark. Фінальний цикл по 50 виконувався послідовно, без паралельних build/повного набору тестів. Вибір меншого пакета зменшує хвости затримок, але не гарантує меншу медіану кожного запиту: читання частіше перекривається з worker.

## Порівняння адаптерів та межі

| Властивість | Старий JSON local | Новий postgres preview |
|---|---|---|
| Default | Без змін | Явний opt-in, development + localhost |
| Persistence | Atomic whole-file JSON | PostgreSQL transactions і source/projection rows |
| Public catalog | In-memory selection з кешем | SQL selection, RLS, page-only payload |
| Admin overview | Full summaries на сервері, 25 у UI | SQL page + SQL aggregates |
| Editorial concurrency | updatedAt + filesystem writer lock | Row lock + updatedAt + source revision |
| Import recovery | Локальні packet files/checkpoint | SQL lease/fence/checkpoint, transactional projection |
| Cloud access | Окремий existing Supabase adapter | Не ввімкнено, remote pool URLs blocked |

Числа етапу 7 були HTTP development на іншому workload; напряму порівнювати їх із SQL-service метриками цього етапу некоректно. Новий механізм прибирає full-file rewrite, проте PGlite не забезпечує production multi-process concurrent connections. Для shared production deployment потрібен native PostgreSQL.

До Supabase **ще не готово для безпосереднього бойового перемикання**: потрібні review міграції 005/нових ролей у staging, погоджене виконання, native runtime wiring і TLS, реальні parallel connections/deadlock/failure tests, backup/restore та перевірка SQL plans. Не можна одночасно читати normalized public.tours старим Supabase adapter і очікувати нові проєкції без окремого вибору read model; наразі це два різні opt-in adapters. Photo upload/delete для PostgreSQL навмисно відхиляються, щоб не змішати старі filesystem assets із новим профілем; нове media-сховище ще не підключено. Старий JSON media workflow незмінний. Наявні `/images/...` і дозволені remote URLs у звичайних шаблонах збережені.

PGlite-профіль має одного власника процесу. Не запускати CLI та Next на одному profile одночасно; файлову multi-process ownership/failover гарантію цей режим не дає. Немає автоматичного retention/purge jobs, імпорту real inventory або запуску платежів. Для реальних зовнішніх записів залишаються чинні вимоги оператора/фото/verification; не можна вигадувати дані для проходження readiness.

Поточний етап не потребує від користувача API-ключів чи хмарних доступів. Подальше застосування Supabase SQL та наступний етап — лише після окремого підтвердження.

## Фінальні результати

TypeScript (`tsc --noEmit`), ESLint усього проєкту, production build (згенеровано 68 сторінок) та **30/30 автоматичних тестів пройшли**. HTTP smoke повторено на фінальному локальному режимі: source draft повернув 404 у публічному каталозі RU/EN, редакторське збереження пройшло. Локальний build не є deployment.

Фінальний workload: N imported drafts + N незалежних public synthetic fixtures; 4 async клієнти + worker, 200 adapter reads на кожен обсяг, пакети по 50. У колонках latency — p95 із 40 вимірів кожного методу:

| Imported N | Catalog, мс | Admin overview, мс | Filtered catalog, мс | Worker + reads, с | Sampled RSS, MiB | Помилки |
|---:|---:|---:|---:|---:|---:|---:|
| 1 000 | 263 | 574 | 262 | 3,58 | 531 | 0 |
| 5 000 | 354 | 623 | 337 | 14,47 | 647 | 0 |
| 10 000 | 345 | 784 | 399 | 27,54 | 678 | 0 |
| 12 500 | 383 | 757 | 413 | 36,36 | 725 | 0 |

0 imported products published в усіх чотирьох прогонах. Це **локальні adapter latency**, не HTTP response/production SLA. RSS включає DB+fixtures+Node, вимірюється періодично і не є доведеним піком. Зменшення пакета 250→50 на 12 500 знизило observed admin p95 приблизно 2769→757 мс, проте worker+reads збільшився приблизно 32,79→36,36 с; компроміс заради реакції локального UI. Медіани й max також збережені в JSON. Не переносити ці числа на Supabase або незалежні native pg connections.

Наявні 26 редакційних карток: SHA-256 до/після `A69096516AEEC450D568CC65E4C4571395E49E8E56C95DED2149F2193AE7D537`. Користувацькі JSON-файли не редагувалися. Всі створені persistent QA-профілі й temp DB видалено; in-memory DB закриті. Порожній `.admin-postgres` root може залишитися. У конфігурації Next прибрані тільки власні тимчасові QA type-paths; `.env.local` не переписано.

## Перелік файлів

Створено:

- `supabase/migrations/202610180005_catalog_projection.sql`.
- `src/features/ingestion/config.ts`, `embedded.ts`, `projection.ts`, `runtime.ts`, `supervisor.ts`, `pool.ts`, `pg-pool.ts`, `jobs-view.tsx`.
- `src/app/admin/api/postgres/route.ts`.
- `scripts/benchmark-postgres-integration.ts`, `postgres-local-import.ts`, `verify-postgres-http.ts`.
- `tests/postgres-integration.test.ts`, `docs/POSTGRES_LOCAL_INTEGRATION.md`.
- `data/benchmarks/stage9/*.json` — raw benchmarks, HTTP smoke і checks.

Змінено:

- `src/features/ingestion/postgres-worker.ts` — optional batchSize; попереднє типове значення 250 збережено.
- `src/features/admin/server.ts`, `media.ts`.
- `src/features/tours/repository.ts`, `local-repository.ts`.
- `src/app/admin/page.tsx`, `import/page.tsx`, `tours/[id]/page.tsx`.
- `src/app/admin/api/import/route.ts`, `catalog-jobs/route.ts`, `src/app/images/admin/[name]/route.ts`.
- `next.config.ts`, `.gitignore`, `package.json`, `pnpm-lock.yaml`, `README.md`.

Підготовлені SQL-файли 001–004 і storage SQL не змінювалися. Новий SQL 005 не виконувався у віддалених сервісах.
