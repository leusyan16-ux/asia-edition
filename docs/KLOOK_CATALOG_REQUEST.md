# Запит на каталог Klook для ASIA EDITION

Перевірено 25.10.2026. Поточне охоплення: лише Південно-Східна Азія (11 країн за UN M49), без території РФ у маршрутах. Договір уже погоджений; повторне погодження договору не є завданням. Цей документ підготовлено для надсилання власником, повідомлення нікому не надіслано.

## Готовий текст для представника

**Subject: ASIA EDITION — request for 900+ product catalog export under our signed agreement**

Hello,

Under our signed agreement, please arrange a product content feed or one-off CSV/JSON export for ASIA EDITION. We do not currently have portal or API access; a file delivered by your team is sufficient.

We need at least 900 unique products across Southeast Asia: Thailand, Vietnam, Indonesia, Malaysia, Singapore, Philippines, Cambodia, Laos, Brunei, Timor-Leste and Myanmar: tours, attraction tickets, shows, museums, parks, activities and transfers. Please include a country/city/category breakdown; package rows should not count as separate products. Exclude destinations outside Southeast Asia, including Japan and South Korea, and any itinerary entering or transiting Russian Federation territory. Supply every itinerary country and transit point for geography verification.

Please supply stable product/package IDs, source URLs, geography, categories, available EN/RU titles and descriptions, package details, inclusions, cancellation terms, and product-linked image files or downloadable URLs. Please specify image hosting, attribution and branding requirements for presentation under ASIA EDITION under our agreement.

For prices, include currency, exact package and traveler basis, age rules, taxes/fees, applicable dates, last verification time and validity period. Flag unavailable information rather than estimating it. Include active/discontinued status and source update timestamps.

Your existing export format is welcome; no custom API is required. Please send a 5–10-product sample and field dictionary first, then the full file and image bundle. Please confirm delivery timing and how updated/withdrawn products will be communicated.

Thank you.

## Куди надіслати

Насамперед закріпленому представнику за чинним договором. Якщо контакту немає — офіційний контакт **affiliate@klook.com**, із посиланням на чинний договір, без пересилання секретів. [Офіційна сторінка Klook](https://affiliate.klook.com/home) підтверджує наявність data feeds для advanced integrations і цю контактну адресу. Публічно доступного завантажуваного CSV/JSON чи гарантованого експорту без кабінету не встановлено. Надсилання файла представником — запитаний спосіб доставки, а не вже підтверджена функція.

## Поля для приймання та чинного імпортера

Постачальник може надати власну схему. Зіставлення виконується наявним адаптером після перегляду реального зразка. Не потрібно вимагати від Klook наші внутрішні статуси, UUID, slug або редакційні дозволи.

| Дані від джерела | Використання в ASIA EDITION |
| --- | --- |
| Стабільний product ID, URL, статус active/discontinued, час зміни джерела та дата формування файла | `provider=klook`, `external_product_id`, `source_url`, `source_status`; дедуплікація за provider + ID. `last_synced_at` — наш фактичний час обробки; він не замінює невідомий час оновлення джерела. |
| Країна, місто/курорт, зовнішні географічні ID, категорія, тип активності | `locations`, `product.country/location/category`, наявний mapping; невідомі значення на перевірку. |
| Назви, короткий і повний описи, мова оригіналу; RU/EN за наявності | `product.title`, `summary`, `description`; відсутній переклад готується чинним локальним перекладачем і перевіряється редактором. |
| Стабільний package ID, назва/опис, що включено, виключення, скасування | `packages[].external_package_id/title/description/inclusions/cancellation`; не об'єднувати різні пакети в одну ціну. |
| Ціна, ISO-валюта, пакет, дорослий/дитячий тариф, вікові межі, одиниця (особа/група/авто), дата послуги, податки, обмеження, verified/valid timestamps | `commercial.prices/packages` тільки за точної відповідності моделі adult/child; групові, динамічні чи непідтверджені тарифи залишаються спостереженнями. Статичний експортер вимагає `verifiedAt`, `validFrom`, `validUntil`. |
| Файли/доступні URL фото, product ID, порядок, підпис, credits, обмеження/строк використання | Перевірка відповідності та дозволеного локального хостингу; публічні оптимізовані файли в `public/images/`. Не використовувати тимчасові підписані URL в snapshot. |
| Підтверджена тривалість, години/часовий пояс, маршрути, місця зустрічі, pickup, FAQ, оператор, умови | Відповідні наявні поля `product`. Невідоме лишається порожнім; рекомендація «3–5 годин» не перетворюється на вигадану фіксовану тривалість. |

Обов'язкова оболонка нормалізованого запису: `provider`, `external_product_id`, `source_url`, `import_status`, `last_synced_at`, `product`. Для нашого CSV додатково обов'язкові колонки `slug`, `country`, `location`, `category`, `title_ru`, `title_en`; для JSON — валідний об'єкт продукту за чинною моделлю. Внутрішні значення генеруються під час підготовки, а не видаються за дані постачальника. `import_status=needs_review`, редакційна перевірка pending, готовність blocked, статус draft. Погоджений договір зберігається як приватне підтвердження прав у чинній системі; імпорт сам не виставляє дозволи.

Формат JSON підтримує `{ "schema_version": 1, "products": [...] }`. Поточні обмеження звичайного імпорту: 8 MiB, 5000 записів, внутрішній пакет 250. Для великого файла використовується вже створений пакетний контур; фотографії передаються окремо. Спочатку перевірити зразок, потім усі 900+, а не вимагати повторного експорту через технічну відмінність назв колонок.

## Наявні реальні записи

Перевірено локально: `data/pilots/klook-public-12/products.json` містить 12 кандидатів; `data/manual-klook-html/batch-real-final-draft-01/products.json` — один деталізований Gardens by the Bay, ID 127, уже врахований серед цих 12. Разом **12 унікальних ID**, а не 13. У Gardens by the Bay є 7 пакетів, локальні зображення та чернетки RU/EN. Його звіт вказує **0 готових до публікації**. Поточний `published-catalog.json` містить **0 записів**.

Ці матеріали можна використати як початок редакційної перевірки й зіставити з отриманим експортом. Наявність фото/ціни в HTML не є підтвердженням права на конкретне фото або чинної комерційної ціни. Зокрема мінімальна ціна пакета-доповнення не є ціною загального вхідного квитка. Потрібні зв'язок фото з продуктом і дозволом за чинним договором, актуальні пакетні тарифи/строки, редакційне погодження та окремий дозвіл публікації. За незмінних правил статичного комерційного каталогу записи без цих підтверджень не експортуються. 26 незалежних редакційних карток не зараховуються до 900 комерційних продуктів і залишаються без змін.

## Швидке оновлення Vercel після отримання файла

1. Зберегти оригінал, фото та field dictionary приватно в `data/`; зафіксувати час отримання, контрольну суму й кількість унікальних ID. Не переносити raw-файли в `src` або `public`.
2. Зіставити 5–10 рядків чинним адаптером. Перевірити ID, географію, пакети, ціни, зображення; після цього підготувати всю партію існуючим імпортером. Усе залишається чернетками; повторні ID оновлюються без дублювання та втрати редакційних правок.
3. Провести редакційну перевірку RU/EN, прав і комерційних умов. Дозволені фото оптимізувати та зв'язати з картками. Відібрати лише повністю перевірену підмножину; не затримувати її лише заради досягнення числа 900. Окремо отримати дозвіл власника на конкретну публікацію.
4. Приватний нормалізований feed перевіряється `scripts/prepare-public-feed.ts`. Його вихід — `{tours,taxonomy}`, потрібний `scripts/export-static-catalog.ts`; це не прямий експорт довільного supplier JSON. Створити worksheet погоджень, перевірити `publicationApproved/imagesApproved/geographyApproved`, експортувати новий окремий sanitized snapshot. SHA-256 погоджень прив'язаний до документа; після змін перевірка повторюється. Докладні команди: [STATIC_CATALOG.md](STATIC_CATALOG.md).
5. Лише після погодження замінити `src/features/tours/published-catalog.json`, додати дозволені фото; змінити `TOUR_DATA_SOURCE=static` в обох секціях `vercel.json` (runtime і build). Перевірити, що налаштування Vercel не перевизначають це значення. Зберегти admin disabled, preview only, inquiries off, worker off, remote PostgreSQL off та інші чинні блокування. `.env.local` не змінювати.
6. Виконати typecheck, lint, tests, production build і локальну перевірку зі static: RU/EN, пошук, фільтри, пагінація, фото та сторінки вибраних пакетів/продуктів, відсутність чернеток і приватних полів. Перевірити, що видима ціна має потрібні умови; непридатний тариф не публікувати. Деплой у чинний Vercel-проєкт, потім HTTPS smoke-перевірка. Попередній deployment лишається варіантом rollback.
7. Домовитися про регулярний оновлювальний файл і список відкликаних ID. Статичний каталог не є live-перевіркою наявності. Прострочені ціни приховуються чинним кодом; зміна статусу/прав у приватному джерелі потребує нового snapshot і redeploy. Бронювання, оплата та Supabase не підключаються.

Цього разу виконана лише перевірка коду, локальних звітів і офіційного джерела та підготовка документації. Нові імпорт, переклад, publication, тести або deployment не запускались. Жодного підтвердження передачі 900 продуктів від Klook поки немає.

Географічний контроль: імпорт перевіряє основну країну, явні країни `routeCountries`, імпортовані локації та текстові ознаки заборонених маршрутів. Для статичного експорту обов’язкове окреме `geographyApproved=true`, прив’язане до SHA-256 документа: редактор перевіряє весь маршрут і транзит, включно з відсутністю території РФ. Автоматична перевірка тексту не доводить безпечність неповного маршруту. Неповні дані не погоджувати.
