# ASIA EDITION — готовність до демонстрації 30.10.2026

Production: https://asia-edition.vercel.app/ru/tours (EN: /en/tours).
Deployment: dpl_6Vyh8WwJuP4Utz2JBNX8L6rz9a9b, Vercel READY.
Попередня робоча версія для контрольованого відкату: https://asia-edition-3tpysopwy-pricol1.vercel.app.

## Публічна частина

2319 схвалених інформаційних карток у чинному статичному snapshot. Схвалення перевірені штатним compileInformationCatalog/staticCatalogRepository; комерційні статуси джерельних чернеток не змінювались. Це не автоматичне схвалення постачальників, цін або доступності.

| Країна | Карток |
|---|---:|
| В’єтнам | 486 |
| Таїланд | 364 |
| Індонезія | 322 |
| Малайзія | 304 |
| Сінгапур | 286 |
| Філіппіни | 246 |
| Лаос | 154 |
| Камбоджа | 140 |
| Бруней | 15 |
| Тимор-Лешті | 2 |
| М’янма | 0 |

2302 картки мають фото; 17 — коректне оформлення без фото. Перевірено всі 2272 унікальні попередні URL: чотири повернули HTTP 404. Тільки ці чотири посилання вилучено з публічної проєкції через повторну штатну компіляцію схваленого знімка; вихідні записи та URL залишилися у локальних джерелах.

159 раніше показаних джерельних цін не мали підтвердженої актуальності. Відповідно до поточного завдання вони вилучені з публічної проєкції, без зміни джерел. Замість них — «Стоимость по запросу» / «Price on request». Ціни, рейтинги, тривалість, слоти й бронювання не вигадувались.

Джерело production — src/features/tours/published-catalog.json, включене в build. Файлова система Vercel не використовується як постійне сховище записів. data/, qa/, .admin-local/, .env* та ZIP виключені з upload. Резервні копії snapshot та оглядові схвалення — у приватній data/management-release-20261030/.

## Перевірки

- 106/106 автоматизованих тестів; TypeScript, ESLint та production build успішні.
- Перевірено по 258 сторінок RU/EN локальним production adapter: 2319 унікальних ID без повторів на кожній мові.
- На реальному production: 48 основних smoke checks, 14 додаткових перевірок безпеки/змін, окрема перевірка справжнього demo-ha-long=404.
- Playwright/Edge на публічному домені: RU 1440px і EN 390px, реальне завантаження видимих фото, галерея, закриття Escape, mobile menu, пошук/країни/остання сторінка; JS errors і горизонтального overflow не виявлено.
- Акаунти, cart routes, admin та commerce API недоступні на production. COMMERCE_ENABLED=false і COMMERCE_GOOGLE_ENABLED=false додано явно в обидва блоки vercel.json. PUBLIC_PREVIEW_ONLY=true, ADMIN_MODE=disabled, TOUR_DATA_SOURCE=static збережено.
- Контрольні суми локальних 2319 чернеток і захищених 26 редакційних карток збігаються з початком завдання.

Журнали: qa/management-{tests,ts,lint,release-build,deploy,live,live-browser}.log; докази: qa/management-{final-report,photo-checks,live-verification,live-safety,browser-report,catalog-pages}.json. Скриншоти production: qa/management-catalog-{ru-1440,en-390}.png і qa/management-detail-{ru-1440,en-390}.png.

## Staging і наступні дії

Окремий staging не підключений: немає налаштованого project ref, CLI-link, management token або DB credentials; у репозиторії є лише вимкнені шаблони. Секретні значення не виводились, .env.local не змінювався. Віддалені Supabase SQL/налаштування Auth не виконувались, 008 не застосовано. Інтеграцію старих і нових admin roles не прискорювали без реальної RLS/Auth перевірки.

Акаунт, кошик, заявки, PDF та нові ролі залишаються локальним MVP із перевірками ізольованої БД й guest UI. Реальні Auth/SMTP/OAuth та повний authenticated HTTP workflow не перевірені. Далі після демонстрації потрібні: окреме підтверджене staging-середовище, Auth/SMTP/redirect URL, контрольоване застосування 008 і тест двома реальними тестовими акаунтами. Деталі — docs/CUSTOMER_REQUESTS_MVP.md.

Для надсилання сайту керівництву ручних дій немає. Онлайн-оплату та автоматичне підтвердження бронювання не вмикали. Чинний Telegram-сценарій — лише підготовка і ручне надсилання заявки, без гарантії місць чи списання коштів.
