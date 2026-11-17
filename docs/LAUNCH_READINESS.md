# ASIA EDITION — готовність до запуску

**Новий пріоритет — перше публічне HTTPS-посилання:** [FIRST_PUBLIC_DEPLOY.md](FIRST_PUBLIC_DEPLOY.md). Нижченаведені Supabase/Storage/007 блокери стосуються повноцінного MVP; вони не блокують окремо підготовлений публічний демонстраційний деплой. Vercel-конфігурація вимикає операції та використовує лише явно позначений демокаталог.

## Актуальне доповнення перед staging

Це поточний стан за кодом; нижче збережено історичний звіт попередньої підготовки. За повідомленням власника, в існуючому Supabase вже застосовані 001–005 та worker-role. Застосування актуальної 006 ще не підтверджено. Агент до Supabase не підключався; створювати новий проєкт або повторювати застосовані файли не потрібно.

**Закритий локальний блокер:** після посилення 006 права на нові фото мали статус unknown, а вебформа їх підтвердження була відсутня. Тепер у збереженій PostgreSQL-картці є блок «Права на фотографии». Він працює через захищений PATCH `/admin/api/images` і чинний `review_media()`: admin + Origin + body ≤4 KiB + сувора валідація + перевірка активного зв'язку фото з продуктом. Підтвердження не публікує продукт. Незбережені зміни потрібно зберегти перед перевіркою; зміна прав може повернути пов'язані картки в чернетки. JSON-режим і схема БД не змінені.

**Перевірки цього доповнення:** **61/61 тест**, TypeScript та повний ESLint — exit 0. Production build (Next 16.4/Turbopack) — exit 0 у `qa/mvp-readiness-build-20261022`. Localhost smoke зібраного артефакту: **30/30 публічних маршрутів RU/EN**, security headers, noindex, анонімний PATCH прав на фото — 403; заявки й DB readiness у вимкненому режимі — 503. Докази: `qa/mvp-readiness-{build.log,tests.tap,eslint.log,smoke.log}` та `data/benchmarks/launch/production-artifact-smoke.json`. `.next`, `.env.local` та 26 карток збережено. Cloud/native staging та повний авторизований browser E2E нової форми не проводилися: перевірено SQL/service цикл, компіляцію форми й HTTP-відмову анонімному запиту.

**Що реально блокує MVP і потребує власника/зовнішньої перевірки:**

1. Підтвердити застосовану версію 006. Якщо її ще немає — лише окремо погоджене застосування перевіреного файла. Якщо вже застосований старий варіант — не перезапускати CREATE; потрібне погоджене сумісне оновлення. Наявну 007 ще потрібно окремо перевірити/погодити: саме вона потрібна для operators, заявок і явного дозволу публікації. Цим завданням 007 не змінювалася й віддалено не виконувалася.
2. Налаштувати окремі server logins, pool/TLS, Auth-адміністратора та приватний Storage; перевірити реальні RLS/SET ROLE і цикл фото через HTTP. Внесення секретів — у secret manager, не в чат. Старі локальні PGlite-профілі не оновлювалися; перенесення файлів/asset registry не відбувається автоматично.
3. Визначити Node-hosting, HTTPS-домен, worker supervisor та перевірити відновлення DB/фото з backup. Затвердити контакти, privacy notice, відповідального за заявки й rate limits перед увімкненням збору персональних даних.
4. Затвердити конкретний реальний асортимент і права на його матеріали. 26 редакційних карток залишаються окремими неопублікованими даними; автоматичної публікації немає. Платежі та гарантоване бронювання не готові й не потрібні для погодженого request-only MVP.

**Наступний практичний крок:** повідомити результат застосування 006, потім окремо погодити перевірку вже наявної 007. До цього не вмикати remote adapter, worker, заявки або публікацію. Після погоджених міграцій — staging-перевірка підключень за [DEPLOYMENT.md](DEPLOYMENT.md).

## Історичний звіт попередньої підготовки

Стан: **2026-10-22**. Локальний цикл перевірено. **Зовнішній запуск поки заблокований інфраструктурою та staging-перевіркою.** Нічого не розгорнуто, зовнішніх запитів/міграцій не виконано. Договір про матеріали Klook за повідомленням власника вже погоджений; повторні переговори не потрібні. Публічний шаблон не виводить provider, source URL або документи про права з адміністративної моделі.

## Реально реалізовано

- Каталог: RU/EN, 13 країн, SQL-проєкція, серверні фільтри/пошук/пагінація, захищене прев’ю. JSON лишився типовим; `.env.local` не змінено.
- CSV/JSON → held job → явний запуск → пакетні транзакції/checkpoint/resume/dedup → редагування/фото → перевірка прав. Повторний імпорт зберігає редакційні поля/фото й повертає продукт у чернетку.
- Новий захищений `/admin/operators`: внесення реально перевіреного оператора. Редактор тепер отримує цей довідник замість порожнього масиву.
- Окреме `/admin/api/postgres` publish-дозволення: авторизований адміністратор, Origin, введення ПУБЛИКОВАТЬ, актуальна версія, перевірені дані/оператор/права, SQL audit. Немає автоматичної публікації. Наявні чернетки не публікувалися; опубліковано лише власну синтетику в тимчасовій тестовій БД, потім профіль прибрано.
- `/api/inquiries`: реальне збереження запиту на зв’язок у PostgreSQL, **не бронювання**. Згода з версією тексту, honeypot, HMAC challenge 2 с–30 хв, дедуплікація повторного запиту, ліміт 3/email/год і 200/год загалом, bounded body 8 KiB, Origin, серверна перевірка публічності. ПІБ/email/текст не пишуться в логи. `/admin/inquiries` — захищений список із пагінацією. Листи не надсилаються: відповідальний має перевіряти список. Оплат/підтверджень місць немає.
- Native PostgreSQL runtime: явний opt-in, окремі URL reader/editor/worker, точний дозволений host, verified TLS, без URL overrides, pool 1–20 (типово 4), bounded timeouts, транзакційний SET LOCAL ROLE, graceful pool close. На build DB не підключається; PGlite не завантажується native runtime статично.
- Private Storage adapter: server-only credential, HTTPS, canonical UUID WebP, no upsert, bounded read 8 MiB, timeout, SQL access check перед proxy read. Фото чернеток не проходять shared image optimizer. Локальний backend збережено. Це код і mocked-contract тести, не перевірена хмарна інтеграція.
- `/api/health` — liveness; `/api/health?check=ready` — native SQL reader/editor schema readiness (не підтверджує Storage/Auth). Robots/indexing вимкнено типово; дозволений production opt-in із HTTPS origin, sitemap та RU/EN alternates сторінки продукту. Security headers: nosniff, frame deny, referrer/permissions policy.

## Блокери, які не можна чесно закрити локально

**P0:** немає погодженого staging/production підключення, DB secrets/roles, перевірених Auth/RLS/TLS та private Storage. Потрібні хостинг Node, HTTPS-домен, secret manager. Native adapter не можна вважати перевіреним на Supabase до реального E2E. Реального відкритого асортименту поки не затверджено — 26 пілотних карток залишаються чернетками.

**P0 перед збором персональних даних:** власник затверджує privacy notice/реквізити/контакти, строки зберігання заявок і відповідального за відповіді. Базова згода у формі не замінює правових документів. Reverse proxy/WAF має обмежувати `/api/inquiries` і `/admin/api/session` за довіреною IP (app не довіряє довільному X-Forwarded-For). У разі потреби captcha підключається окремо. Не вмикати заявки без цього операційного контуру.

**P1:** native PostgreSQL concurrent/failure/load tests, перевірка pool budget і hostname/CA, Storage bucket/object policies, відновлення backup; окреме зіставлення реального feed. Для production native підготовлено нейтральні RU/EN тексти request-only сайту; локальні demo-позначки збережено. Остаточні комерційні тексти/фото затверджує власник. Фото напрямків залишаються ілюстративними. Жодних реальних даних постачальника цей етап не імпортує.

Не реалізовано: списання коштів, гарантовані бронювання, supplier availability API, email-розсилання заявок, автоматичне фізичне очищення media/orphans, автоматичні cloud backups. Повний файл upload до 8 MiB парситься в RAM; необмежені feeds не завантажувати через UI.

## Дії власника зараз

1. Визначити hosting Node + worker, HTTPS-домен і **окремий staging** Supabase; надати окремий дозвіл на підключення/міграції. Не надсилати секрети в чат — заповнити secret manager обраного хостингу.
2. Створити адміністратора Supabase Auth; роль `admin_members` призначає тільки довірений DBA. Увімкнути MFA/мережеві обмеження на рівні платформи де доступно; app не заявляє власну MFA-перевірку.
3. Підготувати перевірений файл асортименту й затвердити конкретні продукти для ручної публікації; чинні 26 не змінювати без окремого рішення.
4. Затвердити privacy/контакти/строки зберігання та процес обробки заявок. Платіжний провайдер не потрібен для request-only запуску.

## Розгортання

Міграції, ролі, Storage, secret manager, worker, backups і rollback: [DEPLOYMENT.md](DEPLOYMENT.md). Інструкція підготовлена; зовнішні кроки не виконані.

## Файли та докази

Фінальна перевірка: **41/41 тестів**, TypeScript, ESLint — exit 0. Native production build із `POSTGRES_REMOTE_ENABLED=false` — успішний у чистому `qa/launch-release-build`, без зовнішньої БД. Local production artifact smoke — **30/30 публічних маршрутів**, noindex, security headers, admin anonymous refusal, вимкнені заявки 503 та DB readiness 503. Це перевірка артефакту в demo mode на localhost, не доказ production DB/Storage.

Повний browser cycle RU/EN desktop/mobile — успішний на власній синтетиці. 12 500 CSV: prepare **19,54 с**, import **34,46 с**, packet p95 **184 мс**, sampled RSS **787,09 MiB**, 0 errors/duplicates/published. Shared workstation, ізольована in-memory DB, не контрольований native/production benchmark і не гарантований peak/SLA. SHA-256 26 карток до/після: `A69096516AEEC450D568CC65E4C4571395E49E8E56C95DED2149F2193AE7D537`. Власні QA-профілі прибрано; `.env.local` не змінено.

Нові: `src/features/ingestion/{native-config.ts,storage.ts}`, `src/features/inquiries/{model.ts,form.tsx,operator-form.tsx}`, `src/lib/site-config.ts`, `src/app/api/{health,inquiries}/route.ts`, `src/app/admin/{inquiries,operators}/page.tsx`, `src/app/admin/api/operators/route.ts`, `src/app/sitemap.ts`, `scripts/catalog-worker.ts`, `tests/launch-readiness.test.ts`, міграція 007, `supabase/{catalog-server-roles.sql,storage-private.sql}`, `config/production.env.example`, цей документ.

Змінені: ingestion `{runtime,pg-pool,connection,embedded,projection,review-panel}`, admin `{server,security,media,components}`, tours `{local-repository,components/detail,components/booking-preview}`, admin layout/postgres API, locale layout/tour page, robots, globals, next.config, staging manifest, upload browser/benchmark scripts, regression test manifest assertion. Попередні SQL 001–006 не переписано; 26 карток і default adapter не змінено.

Докази локальних тестів: `tests/launch-readiness.test.ts`; `data/benchmarks/launch/browser-cycle.json`; `qa/launch/product-{ru,en}-{1440,390}.png`. Окремі локальні навантаження і фінальні результати фіксуються поряд у `data/benchmarks/launch/`. Це **не production/Supabase тести**.

Додаткові файли: `src/lib/site-copy.ts`, `scripts/verify-launch-build.ts`, `docs/DEPLOYMENT.md`, README, `eslint.config.mjs` і `tsconfig.json` (виключено згенеровані QA build-файли; src/tests/scripts залишаються під перевірками), а також метадані головної/країнових сторінок. Тимчасові QA type-paths Next прибрано, next-env повернуто до `.next`.
