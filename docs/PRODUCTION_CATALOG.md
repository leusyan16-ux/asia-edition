# Етап 8 — підготовлений PostgreSQL-контур імпорту

Актуальне продовження: [етап 10 — локальні upload і media](POSTGRES_UPLOAD_MEDIA.md). Статус нижче описує завершення етапу 8.

Дата: 2026-10-18. Це offline-реалізація та перевірка архітектури, **не запуск production і не звіт про хмарне навантаження**. Жодні ключі, `.env.local`, віддалені сервіси та 26 карток не змінювалися.

## Межі й сумісність

Наявні `catalog-jobs.ts`, локальний JSON, public Supabase adapter та адміністративні RPC збережено. Причина нового контуру — виміряне переписування всього JSON на кожному пакеті та 1,18 ГБ RSS на 10 000 записів у попередньому прогоні. Пошук/дизайн/каталог не переписувалися.

`catalog_ingest` — приватний довготривалий ingestion workspace. `products.document` проходить **той самий** `adminTourSchema` і `prepareImport`, що локальний редактор. `readDraftPage` повертає ці документи з keyset-пагінацією, максимум 100 за запит. Це підготовлена серверна межа для майбутнього admin adapter, не новий доступний browser endpoint. Авторизація адміністратора має передувати виклику.

Публічне джерело істини залишається в нормалізованих `public.tours`/translations/images/etc. Імпорт **не записує** в ці таблиці. Прямого перемикання UI, копіювання наявних даних або автоматичного promotion немає. Перенесення перевірених чернеток у normalized inventory потребує окремого транзакційного projection adapter з optimistic revision, аудитом, taxonomy FK та контрольованим адміністративним review. Не можна підмінити це публічним читанням ingestion-документів або викликом `admin_save_batch` від імені користувача worker.

## Файли SQL і порядок

Без окремого погодження **нічого не виконувати на Supabase**:

1. `202610100001_tour_inventory.sql`.
2. `202610100002_admin.sql`.
3. `202610140003_external_import_foundation.sql`.
4. `202610180004_catalog_worker.sql` — нова транзакційна міграція; не містить DROP/TRUNCATE чи перенесення/видалення даних.
5. Необов'язковий `supabase/catalog-worker-role.sql` — окрема одноразова DBA-підготовка NOLOGIN/NOBYPASSRLS ролі, лише після 004. Не запускати повторно і не використовувати наявну роль з невідомими правами. Облікові дані не створює.

`storage-admin.sql` — незалежна операція після admin-міграції; не змінювався. Усі чотири inventory-міграції виконані разом лише в ефемерному PGlite. Наявні Storage-тести перевіряють старий storage-контур окремо.

Таблиці: jobs (lease/fence/checkpoint/retries), parts (immutable за контрактом sealed-пакети з checksum), products (draft documents + revision + source identity), packages (стабільні UUID і FK продукту), mappings (provider/kind/parent/external ID; FK для products/packages), events (лічильники результату кожного committed-пакета). Старі package mappings зберігаються для ідентичності; актуальний асортимент пакетів береться з поточного commercial snapshot документа, а не з усіх історичних mappings.

Індекси: claim queue, provider/country/UUID, unique provider/product, unique slug, RU/EN full-text GIN, review states, job/events. Географічні й категорійні зовнішні ID нормалізуються через наявний `provider-mapping.ts`/офіційний mapper; невідомі ID не вгадуються. `country` має FK до затверджених 13 країн. Остаточні location/category FK належать projection adapter.

До existing external sources додано окремі source/editorial/rights/readiness стани й evidence. SQL trigger блокує спробу публікації пов'язаного зовнішнього продукту без погоджень. Це доповнення до чинних publication checks, а не дозвіл на публікацію.

## Безпека

На всіх ingestion-таблицях увімкнено RLS. У PUBLIC/anon/authenticated відкликано schema/table/sequence/function privileges; браузерних write/read policies немає. SECURITY DEFINER claim endpoint немає: claim — SECURITY INVOKER із порожнім search_path. Окрема worker-роль має доступ лише до ingestion (SELECT/INSERT/UPDATE), не до admin_members/auth/public inventory і не DELETE. Public trigger є SECURITY DEFINER з порожнім search_path та відкликаним прямим EXECUTE.

Worker-роль — довірений серверний компонент, не роль адміністратора браузера. DBA згодом окремо надає її спеціальному серверному connection login. Не надавати anon/authenticated/service frontend membership цієї ролі. Жоден secret не передається Next client bundle. Ротація connection password, TLS, pool sizing та secret manager налаштовуються лише перед погодженим deployment.

## Потік і відновлення

`stageStream` приймає AsyncIterable нормалізованих записів: офіційний adapter/transport або bounded NDJSON (`readNDJSON`). Існуючий UI CSV/JSON не змінено; для великих зовнішніх feeds потрібен серверний streaming parser/adapter, не читання багатогігабайтного JSON через `JSON.parse` цілком.

Пакет — до 250 записів і 4 MiB raw input, окремий рядок максимум 4 MiB. SQL додатково обмежує persisted JSONB packet до 8 MiB; форматування JSONB може збільшити його. У пам'яті worker — поточний пакет і відповідні існуючі документи, не весь каталог. SQL duplicate grouping та missing reconciliation виконуються БД. Повний snapshot зберігається в БД, тому дисковий обсяг і memory БД не є константними.

Підготовка має 5-хвилинний staging lease, поновлюваний при кожному пакеті. Після аварії незапечатане завдання закривається як failed при наступному staging; джерело треба передати повторно (існуючі продукти ще не змінені). Це **не** відновлення незавершеної передачі файлу з байтового offset. Після sealing жодного повторного завантаження не потрібно: worker продовжує з committed cursor.

Усі сторінки snapshot повинні завершитися до sealed=true; порожній feed відхиляється. Дублікати між частинами перевіряються SQL до запуску. Перетини незавершених provider/country scope і старіші snapshots відхиляються. Кожен запис перевіряється на provider/country/snapshot timestamp. Синтетика дозволяється лише явним прапором в ізольованій тестовій БД; у production передавати false.

`claim`: FOR UPDATE SKIP LOCKED, 60-секундний lease, монотонний fencing token. Одне завдання виконується одним власником. Кожен пакет тримає row lock; products + packages + mapping + event + cursor записуються однією транзакцією. Старий власник не може записати після takeover. Повтор committed cursor — no-op. Lease поновлюється на checkpoint. `transactionalDatabase` задає lock timeout 5 с та statement timeout 45 с; на реальному навантаженні ці значення слід узгодити з lease і тривалістю пакета. Завислу відкриту транзакцію також має обмежувати deployment-level idle-in-transaction timeout.

Crash до COMMIT відкочує весь пакет. Crash після COMMIT залишає cursor. Retry — exponential backoff до 1 год, максимум 5 спроб на поточний пакет; exhausted lease переходить у failed при наступному claim. Відновлення failed-після-бюджету — ручна перевірка причини, новий контрольований retry, не нескінченний цикл. `runOneJob` виконує одне завдання; supervisor викликає повторно після idle/backoff. Cancellation і ручний retry потребують майбутнього авторизованого management endpoint; поточний UI не керує PostgreSQL jobs.

Незмінений fingerprint не дублює продукт. Зміна джерела зберігає редакційний документ відповідно до чинного importer. Комерційні факти відокремлені в externalProduct.commercial. Нові/змінені/незмінені ingestion-документи завжди draft і publication blocked. Тільки фінал явно complete scope позначає unseen як missing, не видаляючи їх. Discontinued зберігається окремо. Частковий feed не виконує missing reconciliation.

## Перевірки й навантаження

`node --import tsx --test tests/production-ingestion.test.ts`: реальне виконання PostgreSQL SQL у PGlite, browser role denial, worker RLS/privileges, overlapping jobs, checksum failure, fencing takeover, replay, retry/backoff state, rollback після часткового запису пакета, retry exhaustion, cross-packet duplicates, редакційна незмінність, complete omissions, private draft pagination, UTF-8/oversized NDJSON.

`node --import tsx scripts/benchmark-postgres-ingestion.ts 10000` (або 12500) — offline synthetic harness. Він не завантажує .env, не має network driver, використовує лише in-memory PGlite, сам перевіряє кількість/draft-only/page. Сирі результати: `data/benchmarks/stage8/embedded-*.json`. RSS включає WASM PostgreSQL та його дані в тому самому Node-процесі; не можна прирівнювати його до RSS окремого production worker або гарантувати такий самий результат у Supabase. Один прогін — не p95/SLA.

Production-навантаження **не проводилося**. Підготовлений workload/Database interface дозволяє використати той самий worker з pg-сумісним pool (`transactionalDatabase`). Перед production необхідні погоджена окрема disposable PostgreSQL БД, реальний driver/pool, міграційний dry-run і rollback backup, EXPLAIN ANALYZE на пошуку/claim/reconciliation, паралельні незалежні connections для SKIP LOCKED, kill-process під час транзакції, мережеві timeouts/reconnect, 1/4/8 workers без overlapping scopes, 10k/50k/100k великих синтетичних документів і packages, окремі RSS worker/DB, WAL/disk/autovacuum, p50/p95/p99 та моніторинг queue age/errors/lease expirations. Embedded тест не доводить багатопроцесну конкуренцію або поведінку cloud connection pool.

## Що ще потрібно до підключення

- Погодження застосування SQL у test Supabase, резервні копії, server connection/driver, supervisor, observability й retention для пакетів/журналу. Автоматичного очищення історії немає.
- Projection adapter, admin PostgreSQL management/review endpoints з RBAC/CSRF, optimistic revisions, повернення source metadata в редактор; контрольоване перенесення локального JSON з preservation UUID, dry-run та перевіркою counts/fingerprints. Не завантажувати весь JSON у production worker.
- Окрема перевірка public catalog RPC/планів на великій нормалізованій БД і серверної пагінації admin overview. Чинний Supabase overview ще повертає весь огляд.
- Офіційний Klook контракт, дозволи на контент, документи API/feed та mapper. Реальні endpoints або комерційні дані не вигадувалися.
- Типоспецифічні правила editorial readiness для квитків/інформаційних карток. Чинні вимоги тривалості/фото не слід задовольняти вигадуванням.

Параметри існуючого локального режиму незмінні: `ADMIN_MODE=local`, `TOUR_DATA_SOURCE=local`, потрібний `ADMIN_LOCAL_DIRECTORY`. Новий production-контур не вмикається через ці параметри. Жодного production data-source flag поки не додано.

## Фінальний результат перевірок

TypeScript — passed; ESLint для всього проєкту — passed; production build — passed (67 сторінок); автоматичні тести — **26/26 passed**. Нові PostgreSQL/stream сценарії додані до наявного набору. Browser UI не змінювався і новий ручний browser smoke-test цього етапу не проводився; сумісність підтверджена build і наявними catalog/admin/template тестами.

| Synthetic products | Stage, с | Worker, с | Private page, мс | Sampled RSS, MiB |
|---:|---:|---:|---:|---:|
| 10 000 | 7,66 | 21,14 | 55,41 | 763,84 |
| 12 500 | 15,36 | 23,57 | 57,35 | 691,28 |

0 опублікованих в обох прогонах. Вимірювання 12 500 виконувалося паралельно з build: це не чистий порівняльний експеримент. RSS є максимумом періодичних спостережень із фінальним sample, а не гарантованим піком. Менший RSS більшого прогону пояснюється, зокрема, GC й не доводить спадання витрат із ростом каталогу. Пам'ять embedded DB включена в ці числа. Точні дані — у JSON, без тверджень про production SLA.

SHA-256 пілотного `tours.json` до/після: `A69096516AEEC450D568CC65E4C4571395E49E8E56C95DED2149F2193AE7D537`.

Змінено/створено цього етапу:

- `supabase/migrations/202610180004_catalog_worker.sql`, `supabase/catalog-worker-role.sql`.
- `src/features/ingestion/postgres-worker.ts`, `connection.ts`, `runner.ts`, `stream.ts`, `repository.ts`.
- `tests/production-ingestion.test.ts`, `scripts/benchmark-postgres-ingestion.ts`.
- `docs/PRODUCTION_CATALOG.md`, `README.md`.
- `data/benchmarks/stage8/embedded-10000.json`, `embedded-12500.json`, `checks.json`.

Тимчасовий synthetic inventory жив лише в ефемерних in-memory БД, закритих після тестів. У користувацькі JSON-профілі його не записували. Нові SQL-файли підготовлені до окремого review/test deployment; дозвіл на їх віддалене застосування не запитувався і не використовувався.
