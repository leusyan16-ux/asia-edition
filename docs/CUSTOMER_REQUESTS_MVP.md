# Клієнтські заявки — локальний вертикальний MVP

Дата: 30.10.2026. Це локальна реалізація для staging; production-деплой цього контуру не виконувався. Віддалені Supabase/міграції не запускались, `.env.local` не змінювався.

## Фактичний стан

Публічний статичний каталог — 2319 GetYourGuide-карток. У локальному сховищі ті самі 2319 джерельних чернеток; окремо 26 редакційних карток. Вони не редагувались цим завданням. Новий контур використовує чинний репозиторій каталогу, Supabase SDK, перевірку Origin та обмеження тіла запиту. Нового каталогу, payment backend або фонового сервісу не створено.

## Що реалізовано

- `/ru/account` і `/en/account`, секції `/profile`, `/cart`, `/orders`, `/favorites`, `/password`.
- Серверні email/password login, signup, callback, recovery, refresh, logout; HttpOnly/SameSite cookies, HTTPS cookies у production. PKCE verifier має окрему короткоживу cookie; auth session SDK зберігається лише в пам’яті запиту. Ролі не беруться з user_metadata.
- Google OAuth підготовлено через Supabase PKCE. Кнопка й endpoint вимкнені до `COMMERCE_GOOGLE_ENABLED=true` та реального налаштування провайдера.
- Гостьовий кошик з датою-побажанням, кількістю учасників і примітками; серверний кошик акаунта з optimistic revision, явним перенесенням без дублікатів. Немає вигаданих тарифів або слотів.
- Заявки: серверний номер, транзакція, SHA256 digest, idempotency UUID, до 20 позицій, до п’яти нових заявок/годину на клієнта. Перевіряються опублікована картка й окремий дозволений DB-mirror продуктів. Контактний email береться з перевіреного Auth user, не з довільного body.
- Статуси order, booking і payment розділені. Ручні переходи booking перевіряються в SQL, захищені revision/row locks і мають підставу та audit. Підтвердження однієї позиції не підтверджує все замовлення.
- Квитанція отримання заявки й окремий ваучер після ручного підтвердження з доказовою підставою. PDF RU/EN Unicode, приватна авторизована видача, відмова у видачі скасованого ваучера. JSON snapshots документів зберігаються у RLS-таблиці; PDF генерується на вимогу, без публічного bucket. Версії квитанцій можна повторно створювати через API, до 20; старі не перезаписуються. QR не додається без перевірюваного механізму.
- `/admin/orders`: MFA, пошук, статуси, контакт email, незалежні booking actions і документи. Нотатки/призначення менеджера — аудований RPC/API `manage-order` та форма в деталях; пагінація по 50 заявок. `/admin/customers` дає обмежений пошук заповнених профілів і посилання на історію заявок.
- `/admin/staff`: тільки owner із MFA; ролі, деактивація, запрошення 48 годин, відкликання. Токен зберігається в БД лише як SHA256. Передавання токена — вручну захищеним каналом; жодні повідомлення не відправлялись.
- Експорт власних персональних даних; запит видалення очищує профіль, кошик та обране. Видалення Auth account і визначення строків законного збереження документів — окрема ручна перевірка, а не удавана автоматична операція.
- Per-instance гальмо для auth attempts (10/10 хвилин, bounded memory); воно НЕ замінює Supabase rate limits/CAPTCHA/WAF для кількох інстансів.

## Міграція та ролі

Нова **`supabase/migrations/202610300008_customer_requests.sql`** підготовлена локально. 17 таблиць `commerce_*`: settings, profiles, staff, invitations, products, orders, order_items, bookings, booking_events, travelers, payment_attempts, documents, favorites, carts, privacy_requests, order_notes, audit. RLS на всіх. Попередні 001–007 не переписані. 008 не залежить від даних inventory, потребує штатних `auth.users`, `auth.uid()`, `auth.jwt()`, `anon`, `authenticated`. На реальному Supabase не застосована.

SECURITY DEFINER мають fixed search_path і вузькі EXECUTE grants. Клієнт не вставляє/оновлює orders, bookings, documents або payments напряму. Фінансових write API немає. Службові привілеї не призначаються самостійно. БД додатково початково блокує запити через `commerce_settings.requests_enabled=false`, навіть якщо хтось викличе RPC напряму.

| Роль | Новий контур |
|---|---|
| customer | власні профіль/кошик/обране/замовлення/документи; відкликання непідтвердженої заявки |
| support | читання замовлень і документів, MFA; без підтверджень/керування ролями |
| manager | замовлення, підтвердження з підставою, призначення/нотатки, документи; MFA |
| editor | без доступу до клієнтських замовлень чи призначення admin |
| admin | операційні заявки; без керування ролями чи зміни фінансових записів |
| owner | операційні дії й staff management; MFA; не може змінювати власні привілеї |

**Важливо:** чинний catalog admin досі використовує `admin_members` і окрему сесію. Новий `commerce_staff` не перетворює editor автоматично на старого inventory-admin. Єдине RBAC/MFA для всього старого каталогу ще потребує окремого узгодженого bridge і security-тестів. Не вмикати legacy адмінпанель як нібито вже об’єднану консоль.

## Безпечний перший owner

Після окремого дозволу на staging: зареєструвати користувача й підтвердити email. У `supabase/commerce-owner-bootstrap.sql` замінити нульовий UUID на перевірений Auth UUID і виконати як postgres тільки на staging. Скрипт має transaction lock, відмовляє при існуючому owner або непідтвердженому email, пише audit. Після цього в профілі налаштувати TOTP і підтвердити MFA. Подальші ролі — лише чинний owner через аудований RPC; самопідвищення заборонене.

## Підключення staging — тільки після дозволу

1. Окремий staging проект/branch Supabase та HTTPS origin. Перевірити міграційний ledger і backup; 001–007 повторно не запускати. Застосувати перевірений повний 008 через SQL Editor, залишивши requests_enabled=false.
2. Налаштувати Supabase Auth: підтвердження email обов’язкове, перевірений SMTP, redirect allowlist `https://STAGING/api/commerce/callback`, SITE_URL, парольна політика від 12 символів, rate limits і WAF (для CAPTCHA ще потрібен UI/token passthrough, не вмикати її прапорець без цього). Recovery/email templates мають підтримувати PKCE callback або token_hash + type=signup/recovery. Перевірити листи в різних браузерах; зовнішніх перевірок цього ще не було.
3. Встановити лише на staging: `COMMERCE_ENABLED=true`, `PUBLIC_PREVIEW_ONLY=false`, `SITE_URL=https://STAGING`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `COMMERCE_GOOGLE_ENABLED=false`, поки OAuth не налаштовано. `SUPPORT_EMAIL` — справжня службова адреса, якщо погоджена. Service-role ключ не потрібен. Залишити `TOUR_DATA_SOURCE=static`, старий `ADMIN_MODE=disabled`, worker/payment flags off.
4. Vercel JSON зараз жорстко тримає production preview-safe flags. Для staging потрібна окрема конфігурація, а не надія, що dashboard перекриє vercel.json. Поточний production JSON тут не змінено.
5. Підготувати mirror: `node --import tsx scripts/prepare-commerce-catalog.ts qa/commerce-products-reviewed.sql`. Це тільки створює SQL із погодженого публічного snapshot, не підключається до БД. Перевірити й застосувати файл тільки на staging. Він не торкається джерельних чернеток/26 карток; відсутні у новому snapshot mirror-продукти деактивує, раніше деактивовані не вмикає автоматично.
6. Створити першого owner, підтвердити MFA; після ручної перевірки дозволених продуктів окремо ввімкнути `update public.commerce_settings set requests_enabled=true where id=1` на staging. Це дозволяє тільки ЗАЯВКИ, не оплату чи supplier booking.
7. Двома реальними тестовими Auth accounts перевірити signup/email/login/reset/refresh/logout, IDOR, cart merge, idempotent request, receipt, staff MFA, запрошення/відкликання, підтвердження з реальною тестовою підставою і PDF. Синтетичні fixture-дані не змішувати з каталогом. Production — лише після цього і окремого погодження.

## Що ще не завершено

- Живі Auth/SMTP/Google/MFA і PostgREST/RLS сумісність на реальному Supabase ще не перевірені. Локальні PGlite тести не є production-тестами PostgreSQL 17.
- Уніфіковані RBAC для старого catalog admin; розширений CRM, широкі admin statistics/settings, редакційні bulk actions через нові staff roles.
- Автоматичне завершення GDPR deletion/retention, юридичні строки й privacy policy; немає маскування цього запиту під видалений Auth account.
- Реальні постачальники, тарифи/перевірка доступності, live payments/webhooks/refunds, email delivery документів. Adapters підготовлені лише як контракти, платежі вимкнені.
- Приватний binary Storage PDF/QR-token verification — за потреби; зараз захищені snapshots у БД й on-demand download. Немає фальшивих QR/номерів постачальника.

## Локальні перевірки

106 тестів (102 попередніх + 4 нових). SQL-тест виконує реальні RLS/ACL на PGlite PostgreSQL 18: customer A/B, rollback, idempotency, MFA, заборонені переходи, часткове підтвердження, audit, staff escalation, запрошення й відкликання, приватні документи, privacy/export. PDF RU/EN згенеровано й відрендерено локально; виправлено font subsetting/contextual-glyph проблему, OFL-шрифт статично включено в server trace. Перевірено guest cart і login UI на 1440px RU та 390px EN, без зовнішніх запитів; guest orders/documents=401, admin=404, CSRF=400. TypeScript, ESLint і production build — журнали `qa/commerce-*.log`.

Змінені спільні файли: package.json/pnpm-lock.yaml (pdf-lib/fontkit), next.config.ts (включення OFL PDF-шрифту), locale layout/header/footer (навігація лише за прапорцем), admin layout (посилання на нові захищені секції), tour detail (додавання в кошик лише за прапорцем), .env.example і config/production.env.example. Весь новий код — src/features/commerce/, account route, /api/commerce/[...action], /admin/orders, /admin/staff, /admin/customers; нові SQL і scripts/prepare-commerce-catalog.ts.

Фінальний production build: qa/commerce-verified-build.log; повний регресійний набір: qa/commerce-tests-acceptance.log (106/106), спеціалізовані після нормалізації UTC: qa/commerce-special-final.log (4/4). Фінальні UI перевірки: qa/commerce-ui-final.log та qa/commerce-ui-report.json; зображення qa/commerce-account-ru-1440.png і qa/commerce-cart-en-390.png. Шрифт у PDF перевірено не лише структурно: qa/commerce-pdf-text.log підтверджує коректний текст після вимкнення проблемних contextual glyph substitutions.
