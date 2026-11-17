# Перше публічне HTTPS-посилання ASIA EDITION

Перший деплой — публічна демонстрація чинного сайту, незалежна від Supabase.
Не запуск продажів. 13 країн, RU/EN, демокаталог і демонстраційна сторінка туру зберігаються; зразки явно позначені. Імпортовані продукти та 26 редакційних карток не завантажуються.

## Найкоротший шлях: Vercel CLI без GitHub

Vercel підходить для цього Next.js App Router: не потрібні окремий сервер, база чи власний домен для першого `.vercel.app` URL. Git remote у поточному checkout не налаштований. Не потрібно спочатку створювати GitHub-репозиторій.

У PowerShell відкрити папку проєкту та виконати:

```powershell
Set-Location 'C:\Users\ya14l\Documents\ChatGPT\New project'
npx vercel login
npx vercel --prod
```

1. Увійти у власний Vercel-акаунт через посилання CLI. Паролі/токени в чат не передавати.
2. Підтвердити deployment поточної папки, вибрати свій account/team. Якщо на Vercel ще немає проєкту, створити hosting project з назвою `asia-edition` або іншою доступною назвою; це розміщення існуючого коду, не створення нового сайту.
3. Framework — **Next.js**, root — `./`, Node — **24.x**. Решту build/install налаштувань залишити з `vercel.json`; Output Directory не замінювати на `out`/`public`. У файлі зафіксовано pnpm 10.34.8, сумісний із чинним lockfile v9, frozen lockfile та потрібні build dependencies. У Dashboard не залишати старий override з pnpm 12.
4. Не імпортувати `.env.local`, не підключати Supabase integration, не додавати DB/Storage/Auth secrets. `vercel.json` вже задає однакові безпечні build/runtime значення для першого деплою. Не перевизначати їх у Dashboard.
5. Після успішного build відкрити **Production Domain** з Dashboard → Domains (зазвичай `https://<назва>.vercel.app`), а не захищений випадковий Preview URL. Перевірити у приватному вікні без Vercel login. Якщо з'являється Vercel login — перевірити Settings → Deployment Protection для production domain; Preview deployments можна залишити захищеними.

CLI завантажує файли за `.vercelignore`: `.env*`, локальні каталоги/фото, 26 карток, QA-файли, `.git` і локальні `node_modules` виключені. Не використовувати опції, які ігнорують цей файл. Власний домен можна додати пізніше.

## Повторний деплой після install error — 2026-10-25

Hosting project `pricol1/asia-edition` вже створений і локально прив'язаний. Не створювати його повторно. Відтворена причина помилки: pnpm 12.11.2 з `--frozen-lockfile` вимагає додаткові `packageManagerDependencies`, яких не було в lockfile. Узгоджено `packageManager` і install command на **pnpm 10.34.8**, сумісному з lockfile v9. Додатково чистий build зупинився через security advisory Next 16.4.0: застосовано patch **Next/eslint-config-next 16.4.3** і **Zod 4.6.6**, lockfile оновлено відповідно.

З поточної папки проєкту виконати:

```powershell
npx vercel --prod --force
```

Саме нове завантаження з поточної папки, а не лише Redeploy старого deployment у Dashboard: старий snapshot містить невиправлену команду pnpm 12. Якщо Vercel просить login — виконати `npx vercel login`. В існуючому project перевірити, що старий Install Command override прибрано або відповідає `vercel.json`. Не додавати секрети чи Supabase integration. `--force` запускає нову збірку без повторного використання попереднього build cache.

Перевірки виправлення: exact install-команда pnpm 12 локально відтворила `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`; pnpm 10 виконав чисте встановлення, а остаточний `--frozen-lockfile` завершився успішно без зміни lockfile. На цих залежностях у копії без `.env.local` успішні TypeScript, ESLint, production build **Next 16.4.3**, localhost smoke **59/59** маршрутів і відмова операційним API. `pnpm audit` після patch-оновлення — 0 відомих vulnerabilities на час перевірки. Це Windows/local перевірки, не підтвердження Vercel/Linux deployment. Робочі `node_modules` не перевстановлювалися: Vercel сам встановить за оновленим lockfile. Для локального оновлення залежностей використати ту ж команду pnpm 10 з `vercel.json`.

Підтвердження security fix: [офіційний Next.js advisory](https://nextjs.org/blog/nextjs-security-update-october-14-2026). Інші функції, міграції та дані не змінювалися.

Фінальний повний набір на нових залежностях: **63/63 тестів**. Логи локальних перевірок: `qa/deploy-final-complete-tests.tap`, `qa/deploy-final-{typescript,eslint,smoke}.log`, `qa/deploy-fixed-{frozen-install.log,build.log,audit.json}`. Ці файли виключені з деплою.

## Що перевірити за HTTPS-посиланням

- `/` переводить на `/ru`; `/ru`, `/en`, `/ru/tours`, країни й напрямки відкриваються.
- `/ru/tours/demo-ha-long` позначена як демонстрація і не приймає бронювання/платежі.
- `/admin`, `/admin/login`, `/admin/import`, `/admin/api/*`, `/api/inquiries`, `/api/health?check=ready`, `/images/admin/*` повертають **404**.
- Тільки GET `/api/health` повертає `{ "status": "alive" }` без SQL-запиту. Robots/noindex залишаються вимкненими для індексації демоверсії.

`PUBLIC_PREVIEW_ONLY=true` примусово вибирає демокаталог, вимикає адміністративну авторизацію та забороняє PostgreSQL runtime. Proxy закриває операційні маршрути до їх виконання. Не вимикати цей режим під час першого деплою. Для майбутнього MVP конфігурацію переглянути окремо.

## Межі підготовки

Локально пройдено: **63/63 тести**, TypeScript, повний ESLint, production build Next.js 16.4/Turbopack на Node 24 та **59/59 маршрутів** RU/EN зібраного артефакту. Перевірено закриття адміністрації/API, завантаження 13 країнових зображень і відмову image optimizer для приватного фото. Докази: `qa/first-public-{build.log,tests.tap,eslint.log,smoke.log}`, `data/benchmarks/launch/production-artifact-smoke.json`. 26 карток незмінні; SQL та `.env.local` не змінювалися.

Локальний production build і localhost smoke не підтверджують успішний Vercel build, HTTPS або публічність домену. Агент не виконував login/deploy й не має прив'язаного акаунта. Потрібен лише вхід власника та запуск наведених команд; Supabase і міграції перше посилання не блокують.

Офіційні інструкції: [Vercel CLI](https://vercel.com/docs/projects/deploy-from-cli), [vercel.json](https://vercel.com/docs/project-configuration/vercel-json), [виключення файлів](https://vercel.com/docs/deployments/vercel-ignore), [Deployment Protection](https://vercel.com/docs/deployment-protection).
