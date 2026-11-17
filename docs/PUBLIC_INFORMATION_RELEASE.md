# Публічний інформаційний запуск — 26.10.2026

## Фактичний production

- Домен: https://asia-edition.vercel.app
- Каталог: https://asia-edition.vercel.app/ru/tours (EN: `/en/tours`).
- Повторний production deployment після додаткового підтвердження власника: `dpl_7v8yGeKYrSzpr1K98WsAFDJYCKv9`, стан READY, production alias призначено. Inspector: https://vercel.com/pricol1/asia-edition/7v8yGeKYrSzpr1K98WsAFDJYCKv9
- 849 інформаційних карток: Таїланд 357, В’єтнам 486, Лаос 4, Камбоджа 2. Це не 849 перевірених комерційних пропозицій.
- Джерело: `TOUR_DATA_SOURCE=static`, файл `src/features/tours/published-catalog.json`, включений у Next.js build. Локальні файли не використовуються як постійне production-сховище. Supabase не підключався.

## Погодження та межі

У цій розмові власник прямо підтвердив права на всі надані матеріали та окремо погодив інформаційний знімок назв і редакційних описів без зміни чернеток і без комерційних функцій. Це не автоматичне погодження майбутніх імпортів.

До чинного статичного експортера додано явний `--information` режим. Він вимагає окремого погодження кожного джерельного документа за SHA256, точного scope `titles-editorial-text-only`, часу погодження, дозволеної географії, активного джерела, RU/EN-контенту та унікальних IDs. Зміна джерельного документа потребує нового погодження. Інформаційний snapshot також прив’язує погодження до свого конкретного вмісту; пошкоджені/непогоджені записи відкидаються при читанні.

Публічна інформаційна проєкція має власний published-стан документа. Це не змінює draft-стан чи права/редакційні/комерційні статуси вихідного продукту. Звичайний комерційний експортер і його перевірки залишилися суворими. Не затверджені інформаційним погодженням продукти автоматично не з’являться.

У проєкції вилучено ціни, рейтинги, тривалість, фотографії, пакети, слоти, оператора, комерційні умови, координати, програми/включення/виключення й приватні метадані. `verifiedAt=null`: перевірка комерційної пропозиції не імітується. Назви й редакційні описи відображаються як інформація, бронювання й оплата явно недоступні. RU-назви містять локальний машинний переклад і потребують подальшої редакційної роботи. Країни/напрямки зіставлено з наданими назвами й URL, повні маршрути операторів не підтверджено.

Приватні approval worksheet та звіт: `data/public-information-release/`. Ця папка, `.admin-local`, `.env*`, QA та архіви виключені з Vercel uploads. У знімку немає секретів або `source_metadata`.

## Незмінність джерел

- 849 GetYourGuide-джерел лишилися чернетками; SHA256 `.admin-local/tours.json`: `9B26C9308EBFC438C367E100C08FDE2856CE3B2313982E5A64C49183248CDA81` — до і після збігається.
- 26 редакційних карток не змінено: SHA256 `A69096516AEEC450D568CC65E4C4571395E49E8E56C95DED2149F2193AE7D537`.
- `.env.local`, Supabase, міграції, бронювання та платежі не змінювались.

## Production-конфігурація та безпека

У package.json та lockfile вже був Next.js 16.4.3, але старий node_modules містив 16.4.0. Залежності синхронізовано через pnpm 10.34.8 frozen-lockfile; фактично встановлено 16.4.3, сумісний eslint-config-next 16.4.3, sharp 0.35.5. Production audit: `No known vulnerabilities found`. Попередження вразливого Next.js у новому build відсутнє.

Vercel env/build.env синхронізовані: `PUBLIC_PREVIEW_ONLY=true`, `ADMIN_MODE=disabled`, `TOUR_DATA_SOURCE=static`, `POSTGRES_REMOTE_ENABLED=false`, `POSTGRES_LOCAL_WORKER=off`, `PRIVATE_STORAGE_ENABLED=false`, `INQUIRIES_ENABLED=false`, `SITE_INDEXING_ENABLED=false`. Індексацію залишено вимкненою; це HTTPS-запуск інформаційного каталогу, не запуск продажів.

## Перевірки

- 92/92 автоматизованих тестів (`qa/information-tests-final.log`). Новий тест перевіряє явне/відсутнє/прострочене щодо вмісту погодження, зміну snapshot, відсутність комерційних полів, закритий комерційний експорт і незмінність джерела.
- TypeScript, ESLint, стандартний `npm run build` (Turbopack, Next.js 16.4.3): успішно. Лог `qa/information-build-final.log`.
- Production-dependency audit: 0 відомих вразливостей (`qa/release-audit.log`).
- Локальний production HTTP smoke: 39 публічних маршрутів та відмови для службових маршрутів.
- Реальні HTTPS-перевірки на основному домені: каталог 849, RU/EN, country=vietnam → 486, пошук Hanoi, остання сторінка 95 → 3 картки, сортування, приклади детальних сторінок усіх чотирьох країн, health 200, admin/import/API 404 (`qa/information-live-verification.json`).
- Візуально перевірені desktop та mobile viewport 390 px на локальній production-збірці. Для mobile використовувався тимчасовий localhost iframe proxy, що прибирає X-Frame-Options лише для власного QA: production-захист DENY не змінено. Виправлено горизонтальні відступи та заголовки інформаційної сторінки. Screenshot: `qa/information-mobile-final.png`.
- Публічний каталог відкрито в браузері, показує «Найдено: 849»; screenshot `qa/public-catalog-live.png`.
- Повторна повна HTTPS-перевірка 26.10.2026 16:55 UTC: усі 95 сторінок RU-пагінації, рівно 849 унікальних посилань карток, 0 відсутніх, 0 дублікатів; повний збіг із погодженим snapshot (`qa/all-public-cards.json`). Повторні RU/EN/search/filter/detail/API checks: `qa/information-live-reconfirmed.log`. Вихідні 849 чернеток і hash 26 редакційних карток повторно підтверджено без змін.

## Файли

Змінено `vercel.json`, `src/features/tours/{model.ts,static-catalog.ts,published-catalog.json}`, `src/features/tours/components/{detail.tsx,cards.tsx,editorial.css}`, `src/app/[locale]/{layout.tsx,tours/page.tsx}`, `src/lib/site-copy.ts`, `scripts/export-static-catalog.ts`, `tests/public-preview.test.ts`; додано `tests/information-publication.test.tsx` та цей звіт. node_modules синхронізовано з чинним lockfile; версії package.json штучно не підвищувалися.

## До запуску продажів

Потрібні перевірені пакети, ціни з валютами/строками дії, доступність, оператори, повні маршрути та умови скасування; погоджені фото; редакційна перевірка RU/EN; штатна публікація комерційних продуктів. Окремо — захищений production backend, приймання заявок/бронювання та протестований платіжний провайдер. До цього інформаційні картки не є пропозицією продажу. Для поточного публічного посилання додаткові доступи власника не потрібні.
