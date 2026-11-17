# Окремий Supabase staging для акаунтів ASIA EDITION

## Telegram для нових заявок

1. У SQL Editor проєкту `xnnxmhwvixrqenunhhbt` виконайте
   `supabase/migrations/202611100009_commerce_telegram_outbox.sql` після 008.
   Черга створюється разом із заявкою. Попередні заявки не розсилаються.
2. У Vercel → ASIA EDITION → Settings → Environment Variables додайте лише
   для **Preview** `COMMERCE_TELEGRAM_SUPABASE_SECRET` (серверний secret key
   саме нового Supabase), `COMMERCE_TELEGRAM_BOT_TOKEN`,
   `COMMERCE_TELEGRAM_CHAT_ID` і `COMMERCE_TELEGRAM_CRON_SECRET`
   (випадковий секрет від 32 символів). Позначте секретні змінні як Sensitive.
   Власник має один раз відкрити чат із ботом і натиснути Start.
3. Перезберіть Preview. Для автоматичних повторів налаштуйте серверний
   планувальник на `POST https://asia-edition-staging-pricol1.vercel.app/api/commerce-telegram`
   раз на хвилину. Передавайте `Authorization: Bearer <COMMERCE_TELEGRAM_CRON_SECRET>`.
   Для захищеного Preview також передайте `x-vercel-protection-bypass`
   із чинним Vercel Automation Bypass Secret. Зберігайте обидва секрети в
   налаштуваннях планувальника, окремо від URL і журналів. Vercel Cron для
   Production не використовується.
4. Створіть одну погоджену тестову заявку. Перевірте номер у Supabase та
   Telegram. `sent_at` підтверджує відповідь від Telegram, `last_error` і
   `next_attempt_at` показують стан повтору. Якщо Telegram прийняв повідомлення,
   але відповідь загубилася до запису, повтор іноді може створити дублікат
   з тим самим номером заявки.

Для доступу власника відкрийте **Authentication → Users** у цьому staging,
знайдіть підтверджений email і скопіюйте User UID. Якщо Owner ще не призначено,
вставте UID у локальну копію `supabase/commerce-owner-bootstrap.sql` і
виконайте її в SQL Editor цього проєкту. Після входу додайте та підтвердьте TOTP
на `/ru/account/profile`, потім відкрийте `/admin/orders`. Старий редактор
каталогу потребує власного налаштованого джерела даних і доступу.

Дата: 01.11.2026. Жодних хмарних проєктів, користувачів або міграцій цим завданням не створено. Існуючий `xvzrgnrzbesqwsribpdm` не використовувати для staging. Production-каталог залишається статичним, 2319 інформаційних карток; 26 редакційних карток не змінюються.

## Перевірка проєкту від 06.11.2026

Власник надав виправлений ref `xnnxmhwvixrqenunhhbt` для `asia-edition-staging`. Він має 20 символів і проходить локальну перевірку з URL `https://xnnxmhwvixrqenunhhbt.supabase.co` та тестовими значеннями решти параметрів. Перед запуском SQL-перевірок звірте цей ref і URL у Dashboard нового проєкту.

## 1. Створити проєкт — потрібна дія власника

1. Відкрити https://supabase.com/dashboard → **New project**.
2. Обрати свою організацію, назва **asia-edition-staging**. Якщо тариф/квота не дозволяє створення — не призупиняти й не перевикористовувати невідомий робочий проєкт; погодити окрему організацію або тариф.
3. Згенерувати окремий сильний database password і зберегти у власному менеджері паролів. Не надсилати пароль у чат і не вводити в NEXT_PUBLIC змінні.
4. Вибрати регіон, близький до Vercel Functions. Дочекатися завершення створення.
5. У Settings / Data API та API Keys скопіювати **Project URL**, **project reference** і **publishable key** (або legacy anon key). У чат достатньо назви й Project URL. Ключ зберігати в Vercel Preview; service_role / secret key для цього контуру НЕ потрібні.
6. Перевірити назву й reference у SQL Editor перед кожним виконанням. Reference має відрізнятися від `xvzrgnrzbesqwsribpdm`.

## 2. Мінімальні міграції — без перенесення каталогу

Для реєстрації, кошика, заявок і нових `/admin/orders`, `/admin/customers`, `/admin/staff` потрібна **008**, штатні `auth.users`, `auth.uid()`, `auth.jwt()`, ролі anon/authenticated. 008 не посилається на inventory/projection/ingest і не потребує таблиці tours або міграцій 001–007.

001–007, catalog-worker-role.sql, catalog-server-roles.sql, Storage-міграції та worker **не застосовувати в цьому швидкому контурі**. Вони потрібні лише для окремого майбутнього підключення редактора inventory/імпорту/Storage. Наявні SQL не переписуються й повторно не застосовуються до старої бази.

Порядок у НОВОМУ Supabase SQL Editor під postgres, лише після перевірки цільового project reference:

1. Виконати повний `supabase/checks/commerce-staging-before.sql` (read-only). Мають існувати auth.users, дві auth-функції, anon/authenticated; commerce-таблиць має бути 0. Зберегти результат перевірки. Якщо проєкт не порожній або є commerce-таблиці — зупинитися; не повторювати 008 й не видаляти таблиці. Перед міграцією зробити доступну резервну копію/логічний dump; для справді нового проєкту зафіксувати нуль прикладних даних. Автоматичний backup/PITR тут не налаштований і не перевірений.
2. Після погодження виконати весь `supabase/migrations/202610300008_customer_requests.sql`. BEGIN/COMMIT забезпечують атомарне створення; при помилці не виконувати залишок фрагментами. Повторний запуск не є підтримуваним способом оновлення.
3. Виконати `supabase/checks/commerce-staging-after.sql` (read-only): **17 таблиць, RLS увімкнено на всіх, requests_enabled=false**, anon EXECUTE для commerce-функцій=false, чотири небезпечні table-привілеї=false. Сервісні дані не стають публічними. Власника ще немає.
4. Після перевірки нового staging локально підготувати лише дозволений mirror метаданих: `node --import tsx scripts/prepare-commerce-catalog.ts qa/commerce-staging-products.sql`. Ця команда тільки створює файл, не виконує SQL і не переносить tours. Перевірений SQL застосувати ВИКЛЮЧНО до staging після окремого погодження. Він містить slug/provider/external ID/title/destination/source digest, без цін, фотографій чи статусів джерельних чернеток.
5. До погодженого тесту відправлення заявок залишити requests_enabled=false. Для тесту у staging окремо виконати `update public.commerce_settings set requests_enabled=true where id=1;`. Це не вмикає платежі або підтвердження постачальником.

## 3. Vercel Preview — production не перемикаємо

`vercel.json` залишено без змін: production COMMERCE_ENABLED=false і PUBLIC_PREVIEW_ONLY=true. Він має жорсткі прапорці build/runtime, тому лише додати ключі в Dashboard недостатньо.

Підготовлено `config/vercel-commerce-staging.json` для **окремого Preview deployment** з того самого коду. Воно залишає static-каталог, старий ADMIN_MODE=disabled, worker/remote PostgreSQL/Storage/платежі вимкненими. Захист конфігурації вимагає окремий reference та Preview і забороняє старий Supabase та основний production-домен.

Vercel → pricol1 / asia-edition → Settings → Environment Variables. Додати **лише Preview**, НЕ Production:

| Змінна | Значення |
|---|---|
| COMMERCE_STAGING_PROJECT_REF | xnnxmhwvixrqenunhhbt |
| NEXT_PUBLIC_SUPABASE_URL | https://xnnxmhwvixrqenunhhbt.supabase.co |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | publishable key нового проєкту або його legacy anon key |
| SITE_URL | стабільний HTTPS origin Preview, без шляху/параметрів |

Несекретні прапорці вже задані в staging JSON; зразок — `config/commerce-staging.env.example`. Не змінювати .env.local й не копіювати в Preview credentials старого проєкту.

Після налаштування можна перевірити змінні без запису файла env:

```powershell
npx --yes vercel@65.3.1 env run -e preview -- node --import tsx scripts/check-commerce-staging.ts
```

Ця перевірка читає тільки конфігурацію, не робить мережевих запитів і виводить лише назви помилкових параметрів. Якщо прапорці ще не задані в Preview Dashboard, перед перевіркою додати їх зі staging env.example; staging JSON задає їх безпосередньо під час deploy.

Погоджений Preview deploy, **без --prod**:

```powershell
npx --yes vercel@65.3.1 deploy --yes --local-config config/vercel-commerce-staging.json
```

Потрібен стабільний Preview origin для Auth. Після першої збірки призначити окремий staging alias, якщо він доступний і належить вашому акаунту; наприклад:

```powershell
npx --yes vercel@65.3.1 alias set URL_ОТРИМАНОГО_PREVIEW asia-edition-staging-pricol1.vercel.app
```

Це приклад бажаного alias, він **ще не створений і не перевірений**. Не призначати alias asia-edition.vercel.app. Якщо ім'я зайняте, вибрати інше. SITE_URL, Supabase Site URL і allowlist повинні відповідати саме обраному стабільному staging origin. Після зміни env потрібна нова Preview-збірка й оновлення staging alias на неї. Перед тестами відкрити origin; deployment protection має дозволяти тестувальникам повертатися з email callback. Не передавати bypass-секрети в email URL.

## 4. Supabase Auth у НОВОМУ проєкті

Authentication → Sign In / Providers: Email увімкнено, **Confirm email увімкнено**, пароль від 12 символів. Google залишити вимкненим. Не вимикати підтвердження email, щоб обійти проблеми листування.

Authentication → URL Configuration:
- Site URL: стабільний `https://ВАШ-STAGING-ORIGIN`.
- Redirect URLs: точний `https://ВАШ-STAGING-ORIGIN/api/commerce/callback`.
- Не додавати production origin або широкий wildcard для всього vercel.app.

Authentication → Email / SMTP: налаштувати власний SMTP (host, port, user, password, sender email/name) й перевірити домен відправника. SMTP secrets зберігаються в Supabase Dashboard, НЕ в публічних змінних. Без custom SMTP стандартна відправка Supabase обмежена адресами членів команди, тому не доводить роботу публічної реєстрації.

Email Templates → Confirm signup, посилання для серверного callback:

```html
<a href="{{ .SiteURL }}/api/commerce/callback?token_hash={{ .TokenHash }}&type=signup">Подтвердить email</a>
```

Email Templates → Reset password:

```html
<a href="{{ .SiteURL }}/api/commerce/callback?token_hash={{ .TokenHash }}&type=recovery">Восстановить пароль</a>
```

Це дозволяє підтвердження в іншому браузері; PKCE code flow також підтримується, але verifier потребує того самого браузера. Recovery повертає на `/account/password`. Сесії — HttpOnly/Secure/SameSite=Lax cookies, без refresh token у localStorage. Налаштувати Supabase rate limits і Vercel WAF. Не вмикати CAPTCHA без підтримки captchaToken в UI/API — її ще немає.

Authentication → MFA: увімкнути TOTP. Штатні ролі нової адмінпанелі перевіряються сервером/SQL і потребують aal2.

## 5. Owner і перевірки двома справжніми тестовими акаунтами

1. Створити через staging UI два власні тестові акаунти A/B з реальними inbox, підтвердити листи. Не використовувати виробничих клієнтів/відкриті тестові паролі.
2. Після підтвердження email першого власника взяти його Auth UUID. У копії `supabase/commerce-owner-bootstrap.sql` замінити нульовий UUID і виконати ВИКЛЮЧНО на staging. Скрипт відмовляє при існуючому owner та непідтвердженому email, пише audit. Не додавати Auth UUID або пароль до репозиторію.
3. У `/ru/account/profile` налаштувати TOTP і перевірити MFA; перевірити `/admin/orders`, `/admin/customers`, `/admin/staff`. Без MFA або зі звичайним customer доступ має бути відсутній. Стару каталогову адмінку не вмикати: її admin_members ще не об'єднано з commerce_staff.
4. A: додати екскурсію до входу, увійти — позиція має синхронізуватися без дубля; додати ще після входу; оновити сторінку/повторно відкрити браузер. Вихід/вхід B не повинен показувати кошик/заявки A.
5. Перевірити recovery, новий пароль, expiry/refresh/logout, повторне додавання в обране, порожній кошик, недоступний slug, відсутню ціну, конфлікт revision та відмову мережі без втрати локального кошика.
6. Відправити явно тестову заявку на майбутню дату. Повторний запит з тим самим idempotency key не створює другу заявку. Перевірити запис у commerce_orders/items/bookings/documents, історію і приватну PDF-квитанцію RU/EN. Невідома ціна лишається NULL, списання немає.
7. B: спробувати отримати order/document UUID A через API та Supabase REST — відмова. У support заборонено змінювати статуси, у manager — ролі staff; owner не може змінювати власні права. Перевірити відкликання ролі/інвайту й audit.
8. Ваучер тільки після ручного підтвердження з доказовою підставою; скасований ваучер не видається. Не видавати тестові підтвердження за реальне supplier booking.
9. Перевірити 1440px і 390px, RU/EN, каталог 2319, джерельні чернетки й 26 карток незмінні.

## 6. Production і rollback

Поки новий staging не створено/не перевірено, реєстрація/кошик/заявки/PDF/admin на production залишаються вимкненими. Локальні SQL-тести PGlite PostgreSQL 18 не замінюють інтеграційні перевірки Supabase PostgreSQL 17/Auth/SMTP/PostgREST.

Після sign-off потрібне окреме погодження production-проєкту, backup та застосування 008. Не перейменовувати staging у production й не використовувати невідомий старий проєкт автоматично. У production застосувати ті самі перевірені SQL, окремі credentials/SMTP/SITE_URL, каталог лишити static. Невіддалені Auth/DB тести не оголошувати успішними.

Rollback — повернення попереднього deployment і прапорців COMMERCE_ENABLED=false / PUBLIC_PREVIEW_ONLY=true. Дані заявок зберегти; таблиці не DROP/не TRUNCATE і Auth users не видаляти. Платежі та автоматичне підтвердження постачальником лишаються вимкненими.

Офіційні джерела перевірено 01.11.2026:
- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/server-side/advanced-guide
- https://vercel.com/docs/project-configuration/vercel-json
- https://vercel.com/docs/cli/env

## Результат локальної підготовки
119/119 автоматизованих тестів пройдено; спеціалізовані 7/7; TypeScript, ESLint та production build пройдено. Перевірено локальний гостьовий кошик, збереження після reload, форми, недоступність admin для гостя, RU 1440/320px та EN 390px. Живих Auth/SMTP/двох акаунтів, Supabase PostgreSQL 17 і staging-деплою ще не перевірено. Хеші джерельних даних, 26 карток і публічного snapshot не змінилися.
