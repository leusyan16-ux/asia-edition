# Етап 10 — локальні CSV/JSON upload і фотографії

Історичний звіт етапу 10. Актуальний стан і блокери: [LAUNCH_READINESS.md](LAUNCH_READINESS.md). Після посилення 006 у PostgreSQL-редактор додано окрему вебформу підтвердження прав на керовані фото через `review_media()`; правила публікації та перевірки старих схем нижче описують стан на дату цього звіту.

Дата: 2026-10-19. Реалізація в існуючому ASIA EDITION. Типовий адаптер і `.env.local` не змінювалися. Реальних Supabase/Klook-запитів, віддалених міграцій, публікації чи бронювань не виконано.

## Що працює

У PostgreSQL-режимі `/admin/import` тепер має CSV/JSON upload, шаблони, попередню перевірку, список підготовлених файлів, прогрес пакетів, паузу, продовження після reload і скасування залишку. Адмінпанель російською. Використано наявні `parseInput`/`prepareImport`, `stageStream`, `processPacket`, SQL lease/fencing та проєкцію; JSON workflow збережений.

Файл: UTF-8, `.csv`/`.json`, до **8 MiB**, максимум **20 000 записів**. Загальний multipart body обмежений 9 MiB. JSON — масив або `{schema_version:1,products:[...]}`; CSV — чинний ASIA EDITION формат, не припущення про офіційний Klook feed. Provider і last_synced_at мають бути однакові в усьому файлі; країни визначаються з перевірених записів. Scope завжди partial (`complete:false`): upload UI не виконує автоматичний delisting інших продуктів.

Перевірки виконуються по 50 записів зі зчитуванням лише відповідних source IDs. Виявляються row errors, повтори provider/product ID, дублікати/зайняті slug, конфлікти довідників, недопустимі країни/пакети/джерела та старі timestamps. UI показує перші 20 прикладів і до 100 повідомлень про помилки. Відхилений файл не створює продуктів; синтаксичні/row-помилки живуть у поточному preview, а не видаються за виконане імпортне завдання.

Підготовлені нормалізовані пакети з checksum та receipt зберігаються в SQL. Sealing завдання й прив'язка receipt виконуються однією транзакцією. Завдання утримується через `available_at=infinity`: навіть увімкнений supervisor не почне його до окремого «Сохранить / продолжить». Publication тут не є частиною підтвердження імпорту.

Повтор точно того самого файлу повертає те саме завдання/checkpoint, а не нові продукти. Інший CSV/JSON із тими самими provider/product IDs зіставляється з чинними записами. Незмінений fingerprint пропускається; зміни джерела оновлюються зі збереженням редакційних полів і галереї проєкції. Approvals зберігаються тільки за незмінних facts/lifecycle; зміна джерела вимагає нової перевірки.

Один запит зберігає пакет до 50 записів; source + gallery links + projection + event + checkpoint атомарні. Повтор старого cursor не виконує наступний пакет. Пауза припиняє відправлення наступних пакетів, поточний запит може завершитися. Увімкнений фоновий supervisor продовжує вже дозволену роботу незалежно від вкладки; для ручного тесту рекомендується `POSTGRES_LOCAL_WORKER=off`.

Скасування не видаляє вже збережені чернетки чи пакети. Відкрите скасоване завдання можна явно продовжити. Для пошкодженого пакета: скасувати залишок і повторно завантажити правильний оригінальний файл — створиться нова підготовка, старе завдання збережеться в журналі, а product IDs не продублюються. Незавершена передача/sealing після аварії вимагає повторного upload; staging/reservation lease — 5 хвилин. Прострочений worker lease можна відновити з checkpoint; живий lease не перехоплюється. Ручне продовження після вичерпання retries — явна дія адміністратора.

## Фотографії

Галерея стандартного редактора працює через існуючий `/admin/api/images`. У PostgreSQL-режимі файли лежать **тільки** в `.admin-postgres/<profile>/assets/<uuid>.webp`; старий `.admin-local` для них не використовується.

- JPEG/PNG/WebP до 8 MiB; MIME звіряється з magic bytes.
- Sharp декодує файл із лімітом 40 млн пікселів, орієнтує, зменшує до 2400×2400 без збільшення й повторно кодує у WebP. SVG/пошкоджені/підмінені файли відхиляються; EXIF не переноситься.
- Імена створює сервер; exclusive write не перезаписує наявні байти. Шляхи обмежені приватним каталогом; traversal і symlinks відхиляються.
- `media_assets` містить UUID/key/SHA-256/розмір/автора/backend/стан прав (default unknown). `media_links` має FK до продукту й asset; SQL trigger синхронізує галерею при save та source refresh.
- До збереження картки фотографія є pending asset без product link. Вона доступна тільки адміністратору. Після save зв'язок створюється транзакційно.
- Приватний endpoint вимагає admin session; публічний `/images/admin/<key>` видає байти тільки за активним зв'язком з дозволеною публічною карткою. Для чернетки — 404. Відповіді private/no-store і nosniff.
- При повторному імпорті редакційна галерея зберігається й посилання не втрачаються.

Прибирання фото — **retirement, не фізичне стирання**. SQL перевіряє активні links, проєкції, immutable source documents та всі пакети, включно з percent-encoded URL. Невизначені посилання блокують операцію. Gallery save і retirement синхронізовані транзакційним advisory lock. Видалений із галереї файл можна закрити для доступу тільки після збереження; байти лишаються на диску. Історичні source references можуть блокувати retirement, навіть якщо поточна галерея вже порожня.

`MediaStore` — серверна абстракція put/read/backend. Реалізовано `LocalMediaStore`; Supabase Storage implementation **не підключено й не імітується**. У майбутньому потрібні приватний bucket і server proxy/короткоживучі signed URLs після перевірки доступу. Старий `storage-admin.sql` для legacy public demo bucket не слід автоматично застосовувати як конфігурацію нового приватного photo-сховища.

Файл пишеться перед реєстрацією SQL metadata. При збої реєстрації може лишитися приватний orphan; API без metadata його не видає. Фізичний purge/retention/quota та узгоджений backup SQL+assets ще потребують окремої політики. Завантаження не означає підтвердження авторських прав.

## Перевірка прав і публікація

У редакторі додано форму review, HTTPS evidence та контроль застарілого updatedAt. Вона відмовляє при незбережених змінах редактора. Звичайний save не може змінити source metadata; review не публікує продукт.

Міграція 006 додає окрему `publication_permissions`, прив'язану до revision документа й source revision. Reader/editor/worker не мають права видавати такі дозволи; endpoint видачі дозволів відсутній. SQL trigger блокує публікацію імпортованого документа навіть після successful review/readiness. UI не пропонує для нього published. Жодного publication permission у робочих даних не створено. Перед майбутньою публікацією потрібні окремий погоджений workflow і політика прав, зокрема щодо кожної фотографії.

## Міграції й локальний запуск

Додано `supabase/migrations/202610180006_local_uploads_media.sql`, після 005. На новому профілі: 001 → 002 → 003 → 004 → `catalog-worker-role.sql` → 005 → 006. Відкриття чинного локального профілю зі схемою 005 додає 006 транзакційно; повторний запуск перевіряє marker. Окремий тест підтверджує незмінність наявних documents та відкликання успадкованих browser grants. DROP/TRUNCATE, backfill існуючих галерей чи фізичне очищення відсутні.

Перезапустити Next після оновлення коду або зміни режиму. Для поточної PowerShell-сесії:

```powershell
$env:ADMIN_MODE='local'
$env:TOUR_DATA_SOURCE='postgres'
$env:POSTGRES_LOCAL_PROFILE='development'
$env:POSTGRES_LOCAL_WORKER='off'
pnpm dev --hostname 127.0.0.1
```

`ADMIN_LOCAL_DIRECTORY` лишається місцем чинної локальної identity. За відсутності identity — штатний `pnpm admin:setup` для власного локального адміністратора. `.env.local` не треба переписувати. Новий профіль не копіює 26 карток і спочатку порожній.

Відкрити `/admin/import`, перевірити файл, переглянути помилки, явно зберегти/продовжити; далі `/admin` → редактор → upload фото → save → review → private preview RU/EN. Публічні `/ru/tours` і `/en/tours` не показуватимуть імпортовані чернетки. Для синтетики використовувати тільки `test-*`/`qa-*` профіль і `test_data:true`.

Один persistent PGlite profile — один власник процесу. Не запускати CLI та Next на ньому одночасно. In-memory benchmark databases незалежні від web-профілю. Для повернення JSON зупинити Next, повернути попередній `TOUR_DATA_SOURCE=local` і перезапустити; жодне типове значення автоматично не змінюється.

## Підготовка staging

`config/supabase-staging.example.json` — вимкнений checklist/manifest, а не активний connector. Містить порядок SQL, ролі, verified TLS, pool max=4, timeouts, private Storage та заборону browser DB credentials. Він не читає ключів і не відкриває connection.

До окремо погоджених staging-перевірок потрібні:

1. Review SQL/ролей на disposable staging, backup/restore plan, окремий дозвіл на remote execution. Локальний `initializeEmbedded` з auth stubs **не** запускати на Supabase — застосовуються тільки погоджені migration files.
2. Native runtime adapter з approved host allowlist, `rejectUnauthorized=true`, довіреним CA, серверним secret manager; жодних DB/service-role секретів у NEXT_PUBLIC/browser. Чинний `createLoopbackPostgresPool` усе ще відхиляє remote URLs, навіть якщо змінити example JSON.
3. Окремі restricted login memberships для reader/editor/worker, без BYPASSRLS. Перевірити сумарний pool budget усіх Next/worker процесів, реальні pg connections, SKIP LOCKED, deadlocks/timeouts, supervisor restart та примусові збої.
4. Реальний private Storage adapter/bucket/object RLS, URL-expiry/cache, права на фото, quotas/retention, узгоджена звірка SHA та SQL+bytes backups. Не робити legacy private bucket публічним.
5. Перевірка SQL plans, source geo/category mappings та publication workflow. Реальні Klook contracts/feeds і ліцензії залишаються окремими передумовами; endpoint-форматів не вигадували.

Локальна функціональність готова до review staging-пакета, але реальний Supabase end-to-end ще не перевірено й не дозволено. Від користувача зараз не потрібні API-ключі або зовнішні доступи.

## Відтворення перевірок

- `node --import tsx --test tests/*.test.*`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js .`
- `node node_modules/next/dist/bin/next build`
- `node --import tsx scripts/verify-postgres-upload-ui.ts` — Windows browser harness із bundled Playwright/встановленим Edge; для CI потрібен відповідний browser runtime. Власний localhost:3013 профіль очищається після перевірки абсолютних шляхів.
- `node --import tsx scripts/benchmark-postgres-upload.ts 12500 csv` — in-memory SQL service benchmark, не production/HTTP benchmark.

Браузер реально пройшов JSON upload 101 TEST запису → pause/checkpoint → reload/resume → редактор → власноруч згенерований TEST image → save → review → RU/EN private preview → CSV reimport. Перевірено збереження фото/правок/approvals, 404 для публічного tour/image, відмови anonymous/CSRF, desktop/mobile overflow. Screenshots: `qa/stage10/{import,editor}-{desktop,mobile}.png`; JSON — `data/benchmarks/stage10/browser-cycle.json`. Жодних чужих фото не завантажувалося.

Load workload: ізольовані мінімальні TEST продукти, по 50 записів/пакет, валідація + held job + явний release + replay/checkpoint + збереження. Зчитується лише поточний inventory-пакет, проте multipart/CSV/JSON файл до 8 MiB парситься в пам'яті цілком; це не unbounded streaming upload. Більші нормалізовані streams лишаються CLI/adapter-задачею після зупинки Next на відповідному профілі.

| Записів / формат | Prepare, с | Import, с | Packet p95, мс | Sampled RSS, MiB | Помилки / дублікати / published |
|---|---:|---:|---:|---:|---|
| 1 000 JSON | 1,20 | 2,91 | 170 | 518 | 0 / 0 / 0 |
| 5 000 CSV | 8,07 | 14,11 | 191 | 646 | 0 / 0 / 0 |
| 10 000 JSON | 12,81 | 26,69 | 175 | 700 | 0 / 0 / 0 |
| 12 500 CSV | 20,64 | 33,66 | 181 | 768 | 0 / 0 / 0 |

RSS включає Node+WASM PostgreSQL+дані, максимум періодичних спостережень, не доведений peak. Це один прогін на обсяг/формат, не SLA. PGlite серіалізує SQL; native multi-process/TLS/Storage cloud load tests не проводилися. Продукти з великими описами/галереями/пакетами потребуватимуть окремого вимірювання. Сирі дані: `data/benchmarks/stage10/upload-*.json`.

## Файли цього етапу

Фінальний прогін: **35/35 тестів**, TypeScript, ESLint і production build успішні; остання збірка без попереджень. Build не означає deploy. Браузер не мав page/hydration errors; зафіксовано лише favicon 404 та dev CSS preload warning. Підсумок перевірок — `data/benchmarks/stage10/checks.json`. Контрольна SHA-256 26 редакційних карток до/після: `A69096516AEEC450D568CC65E4C4571395E49E8E56C95DED2149F2193AE7D537`. Власні тимчасові QA-профілі очищені; профіль `pilot-editorial-26` збережено.

Нові: міграція 006; `src/features/ingestion/{upload.ts,upload-panel.tsx,review-panel.tsx,media.ts}`; `src/app/admin/api/postgres-import/route.ts`; `config/supabase-staging.example.json`; `tests/postgres-upload-media.test.ts`; `scripts/{verify-postgres-upload-ui.ts,benchmark-postgres-upload.ts,fixtures/stage10-products.ts}`; цей звіт і `data/benchmarks/stage10/*.json`.

Змінені: `src/features/admin/{import-engine.ts,media.ts,components.tsx}`; `src/features/ingestion/{embedded.ts,postgres-worker.ts,jobs-view.tsx}`; `src/app/admin/{import/page.tsx,tours/[id]/page.tsx,admin.css}`; `src/app/admin/api/images/[name]/route.ts`; `src/app/images/admin/[name]/route.ts`; README та посилання в трьох попередніх технічних звітах. Тестовий Next output/type-paths прибираються; default adapter, `.env.local`, попередні SQL 001–005/storage і 26 карток не переписувалися.
