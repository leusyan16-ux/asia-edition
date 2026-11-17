# Зовнішній CSV/JSON-імпорт — етап 2

Імпорт працює у локальній адміністрації: `ADMIN_MODE=local`, `TOUR_DATA_SOURCE=local`, development та localhost. `.env.local` і віддалена база автоматично не змінюються. Supabase-збереження зовнішніх продуктів поки відключене; старий CSV-імпорт власних турів збережено.

## Формат і межі

`/admin/import`: завантажте CSV або JSON → «Проверить файл» → перегляньте всі помилки → «Сохранить пакетами». Максимум 5000 продуктів / 8 МБ за файл, по 250 за атомарний пакет. Зупинка завершує поточний пакет; попередні пакети зберігаються. Повторний запуск не створює дублікатів.

Шаблони завантажуються в адмінпанелі. JSON — наш нормалізований формат, **не формат Klook API**:

```json
{
  "schema_version": 1,
  "products": [
    {
      "provider": "test_fixture",
      "external_product_id": "TEST-001",
      "source_url": "https://example.invalid/test-products/001",
      "import_status": "pending",
      "last_synced_at": "2026-10-14T00:00:00Z",
      "test_data": true,
      "product_type": "museum",
      "product": {
        "slug": "test-only-museum",
        "country": "japan",
        "location": "kyoto",
        "category": "museums",
        "title": {"ru":"ТЕСТ — синтетичний продукт","en":"TEST ONLY — synthetic product"},
        "description": {"ru":[],"en":[]},
        "prices": [],
        "availability": []
      }
    }
  ]
}
```

Також приймається JSON-масив записів. Метадані `provider`, `external_product_id`, `source_url`, `import_status`, `last_synced_at` обов'язкові. Provider нормалізується до нижнього регістру; зовнішній ID зберігає регістр. URL має бути HTTPS; timestamp — ISO 8601. На нових/змінених записах сервер встановлює `needs_review`, а не довіряє прапорцю перевірки з файла. Старіші знімки джерела відхиляються.

`product` використовує поля існуючого `AdminTour`: `slug,country,location,category,title,summary,description,highlights,itinerary,durationMinutes,transportation,languages,timezone,meeting,pickup,pickupLocations,meetingPoints,inclusions,exclusions,faq,cancellation,bookingConditions,seo,images,prices,departures,availability,city,resort,slots`. Внутрішні ID, статус, перевірка, архів і featured не приймаються з джерела. Назви RU/EN потрібні для імпорту; переклади не вигадуються. Порожня ціна означає невідому ціну, а не безкоштовний продукт.

CSV використовує старі колонки плюс метадані, `test_data,product_type,packages_json,locations_json,availability_json`. Програма/FAQ/галерея/пакети/календар — JSON усередині екранованого CSV-поля. UTF-8, кома, стандартне подвоєння лапок. Зберігається підтримка усіх 13 країн; неазійські країни відхиляються.

`product_type`: excursion, tour, ticket, show, entertainment, park, museum, transfer, activity. Додаткові локальні категорії: tickets, shows, entertainment, parks, museums, transfers, tours; старі п'ять категорій залишаються.

## Міста, курорти, пакети

Нові місця можна передати у `locations`: `{slug,country,name:{ru,en},kind:"city"|"resort"|"destination",parent:null}`. Вони мають належати країні продукту; конфлікти зі справочником та в межах файла відхиляються. Для Турції потрібне явне `asian_territory_verified=true` лише після фактичної перевірки азіатської території. Прикладові дані не є перевіркою реальних місць. Збережені місця доступні в адміністративних селекторах; публічний локальний справочник додає їх лише з опублікованих продуктів.

`packages`: `{external_package_id,title:{ru,en},description:{ru,en}|null,inclusions:{ru:[],en:[]},cancellation:{ru,en}|null,prices:[]}`. ID пакета у продукті має бути унікальним. Пакети й комерційні дані доступні в редакторі в окремому розділі джерела; вони не активують бронювання та не підміняють редакційні ціни.

## Повторний імпорт і збереження

Ключ — `provider + external_product_id`, а не slug. Конфлікт адреси іншого продукту не перезаписує його. Незмінений знімок пропускається, лише оновлюючи timestamp синхронізації. Зміна джерела оновлює `externalProduct.facts` і `.commercial`, знімає публікацію/перевірку туру, але не змінює його редакційні назви, описи, SEO, ціни, фото, місця чи slug. Приведені до одного виду дані хешуються незалежно від порядку ключів JSON.

Перший імпорт створює редакційну чернетку з фактичного контенту, але залишає редакційні ціни, дати й розклад порожніми. Дані джерела окремо зберігають тарифи/пакети/розклад/наявність. Для повторної публікації потрібно перевірити зміни та свідомо оновити редакційну картку. Поля джерела через звичайне збереження редактора не змінюються; копія туру не успадковує зовнішній ID.

`.admin-local/tours.json` підтримує старий масив записів. Наступне збереження атомарно пише envelope `{version:2,tours:[...],imports:[...]}`, не видаляючи попередні тури. Каталог та адмінпанель читають обидва формати. Одне блокування й rename зберігають продукт і журнал разом. Версія попереднього перегляду захищає від паралельних правок. `batch_id` і digest запобігають повторному застосуванню запиту після мережевого збою.

Журнал показує останні 50 пакетів; у файлі зберігається повна історія. Є created/updated/skipped/failed, рядки, actor і timestamp. Помилки перевірки також журналюються без збереження продуктів; великий журнал помилок обмежує деталізацію першими 1000 рядками, лічильник враховує всі. Відкат атомарний для пакета, а не всього багатопакетного файла. Перед реальною масовою операцією зробіть резервну копію локального сховища.

## Ізольовані синтетичні дані

Готові файли: `tests/fixtures/external-products.test.json` і `.csv`. Вони не завантажуються автоматично й не містять реальних тарифів, місць чи відгуків.

Для ручної перевірки запустіть окремий профіль (PowerShell):

```powershell
$env:ADMIN_LOCAL_DIRECTORY='.admin-local/test-import'
pnpm admin:setup
$env:ADMIN_MODE='local'
$env:TOUR_DATA_SOURCE='local'
pnpm dev --hostname 127.0.0.1
```

Це параметри поточного термінала, не зміна `.env.local`. Імпорт `test_data=true` заборонено у звичайному профілі; дозволено лише `test-*` або `qa-*`. Не використовуйте тестовий профіль для реальних продуктів. Після перевірки закрийте цей сервер і відкрийте новий термінал для основного каталогу.

## Klook і Supabase

`ProductFeedAdapter` та `KlookAdapter` приймають погоджений mapper офіційного payload. Без нього адаптер повертає явну помилку, не робить HTTP-запитів і не вигадує endpoint чи структуру API. Перед інтеграцією потрібні офіційний доступ, документація, дозволи на тексти/фотографії та погоджене зіставлення полів. Автоматичного scraping або завантаження фотографій немає.

Файл `supabase/migrations/202610140003_external_import_foundation.sql` готує приватні таблиці метаданих та журналу з RLS і унікальним provider/ID. Він **не застосований**. Для реального Supabase-імпорту ще потрібен перевірений транзакційний RPC/адаптер, узгоджене застосування міграції та інтеграційні тести. Зараз зовнішній імпорт дозволений тільки в локальному режимі; існуюче Supabase-збереження власних турів збережене.

## Файли реалізації

Нові:
- `src/features/admin/external-model.ts`
- `src/features/admin/import-engine.ts`
- `src/features/admin/import-panel.tsx`
- `src/features/admin/local-taxonomy.ts`
- `src/features/admin/klook-adapter.ts`
- `supabase/migrations/202610140003_external_import_foundation.sql` — лише файл, без виконання у Supabase
- `tests/external-import.test.ts`, `tests/external-database.test.ts`
- `tests/fixtures/external-products.test.json`, `tests/fixtures/external-products.test.csv`
- `docs/EXTERNAL_IMPORT.md`

Оновлені:
- `src/features/admin/model.ts`, `local-store.ts`, `csv.ts`, `server.ts`, `components.tsx`
- `src/features/tours/local-repository.ts`
- `src/app/admin/api/import/route.ts`
- `src/app/admin/import/page.tsx`, `layout.tsx`, `admin.css`, `tours/[id]/page.tsx`
- `README.md`, `docs/ADMIN.md`

Перевірки: TypeScript, ESLint, production build; 18 автоматичних тестів. Окремий HTTP-сценарій перевірив 3 синтетичні продукти, повторний імпорт, редакційні правки, CSV/JSON, журнал помилок та недоступність чернеток. Browser-перевірка підтвердила повторний імпорт через форму й desktop/mobile компонування. Тимчасовий QA-профіль, його обліковий запис, скрипти та збірку видалено; тестові fixtures залишено для відтворення тестів. Реальний каталог не наповнювався.
