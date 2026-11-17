# Playwright-пілот Klook: фактичний результат

25.10.2026, 19:51:56–19:51:58 UTC. Стандартний Playwright **1.62.1** із Microsoft Edge у headless-режимі, новий порожній browser context. Playwright узято з наявного локального runtime; залежності сайту не змінено.

## Результат

| Показник | Факт |
| --- | --- |
| Підготовлені унікальні activity IDs | 11 існуючих справжніх URL-кандидатів із Сінгапуру; activity 127 виключений |
| Фактичні переходи | **1**, activity **117**, Universal Studios Singapore |
| HTTP | **403**, response server: cloudflare |
| Решта 10 переходів | Не виконані після обмеження |
| Повторні спроби | 0 |
| Нові реальні продукти / пакети | **0 / 0** |
| Нові описи, географія, ціни, фото URL | Не отримані; відповідь не є продуктовою сторінкою |
| Автоматично знайдені нові activity URL | 0; читання посилань зі сторінки не виконувалося після 403 |
| Готові до публікації | 0 |

Відкрито `https://www.klook.com/en-US/activity/117-universal-studios-singapore/`. Title — `klook.com`, текстова CAPTCHA не виявлена. Зафіксовано відмову доступу, але точну причину рішення Cloudflare цей тест не встановлює. Немає підстав стверджувати, що всі інші URL завжди заблоковані або що Klook забороняє автоматизацію конкретним пунктом нашого договору. Проте продовження обходом цієї відмови не відповідає завданню.

Після 403 пілот глобально зупинено. Не застосовувалися stealth, зміна User-Agent, proxy/IP rotation, cookies користувача, login, CAPTCHA-solving, replay, альтернативні приватні API або повторна спроба іншим браузером. Масового збору 900+ не було.

## Що реалізовано й використано

Невеликий локальний сценарій `qa/klook-playwright-pilot.cjs`: перевіряє SEA-географію вихідної черги, HTTPS/host/ID та відсутність дублікатів, обмежує чергу 20 продуктами, відкриває послідовно й зупиняється за 401/403/429, ознаками challenge або помилкою навігації. Після дозволеного завантаження він міг би зберегти DOM, джерело, час і SHA-256 та пасивно прочитати activity-посилання з DOM. Нові посилання без перевіреної країни не ставляться в чергу. Ці успішні мережеві гілки **не перевірені на Klook**, оскільки перший перехід заблокований.

Структуровані відповіді записуються тільки як побічний результат звичайної браузерної навігації в приватний HAR; жоден endpoint не викликається окремо. HAR передається наявному `scripts/unpack-klook-har.ts`, потім успішні пари оброблялися б чинним `parse-klook-html.ts` / `prepareImport` із перекладом, географією та статусом draft. Нового імпортера або production crawler не створено.

Збережений реальний HAR перевірено чинним розпакувальником: **1 entry, 1 ignored, 0 activity IDs, 0 пар HTML/JSON, 0 продуктів**. Отже, сторінка блокування не стала туристичним продуктом. Контентні/цінові поля з неї не вигадувалися.

## Докази

У приватній папці `data/manual-klook-html/playwright-pilot-01/`:

- `report.json` — час, URL, HTTP і причини зупинки;
- `seeds.json` — черга 11 реальних кандидатів, не 11 успішних capture;
- `private-capture.har` — фактична браузерна відповідь, не публікувати;
- `access-result.png` — порожній viewport відповіді відмови; це не скриншот продукту;
- `extracted/har-report.json` — результат чинного розпакувальника.

Існуючий activity 127 із вручну збережених HTML/JSON залишається попереднім окремим результатом. Його не зараховано до нових продуктів цього пілоту. Дванадцять давніших indexed-кандидатів також не є дванадцятьма готовими комерційними картками.

## Перевірка обмежень та офіційний шлях

[robots.txt Klook](https://www.klook.com/robots.txt) у групі `User-Agent: *` не містить загальної заборони activity-сторінок, але виключає `*/search/*`, `*/searchresult/*`, voucher/preview та низку hotel API. Умови окремих named bots не підміняють wildcard-правила. Заборонені пошукові маршрути не використовувалися. Наявність Allow або відсутність Disallow **не є договірним дозволом** і не скасовує HTTP 403.

[Playwright офіційно підтримує passive network observation](https://playwright.dev/docs/network) та [HAR recording](https://playwright.dev/docs/api/class-browser#browser-new-context-option-record-har), але ці технічні можливості не дають права обходу блокувань. [Klook офіційно пропонує data feeds](https://affiliate.klook.com/home); публічного готового CSV/JSON для нашого використання не підтверджено.

Договір прийнято як чинний, повторного юридичного аудиту немає. Конкретний дозволений транспорт автоматичного отримання контенту договором у репозиторії не встановлено; технічний тест не підтвердив доступ. Поточний шлях Playwright **не підтверджений як придатний для масштабування**.

## Наступна практична дія

Передати представнику Klook уже підготовлений `docs/KLOOK_CATALOG_REQUEST.md` та доповнення:

> Our standard unauthenticated Playwright browser pilot received HTTP 403 on the first public activity page and was stopped without retries or bypass. Please provide a permitted product content/package feed or CSV/JSON file under our existing agreement. A file transfer is sufficient; portal access is not required. Please send 10–20 distinct activity IDs with full product content, geography, package details, image references and explicitly scoped prices first, then the 900+ Southeast Asia catalog. Please provide your supported automated delivery method and update/withdrawal procedure.

Не потрібно вручну відкривати 900 сторінок. Для першої інтеграції достатньо одного наданого файла/архіву з 10–20 різними activity IDs. Після отримання реальної схеми використовується чинний `KlookAdapter` і пакетний імпортер, без вигаданого endpoint. Якщо Klook надасть документований feed, окремо налаштовується дозволений server-side transport; приватні ключі в чат не надсилати. Невідомі ціни/права/маршрути не погоджуються автоматично.

Географія залишається 11 країнами UN M49 Southeast Asia: Brunei, Cambodia, Indonesia, Laos, Malaysia, Myanmar, Philippines, Singapore, Thailand, Timor-Leste, Vietnam. Будь-яка частина маршруту територією РФ виключена. Усі імпортовані продукти — чернетки.

## Локальні перевірки

- Профільні HAR + saved JSON + geography тести: **9/9 PASS**. Включають 20 синтетичних HAR-пар, 900 синтетичних JSON-відповідей, дедуплікацію, відхилення 403 і географічні обмеження. Це **не нові реальні продукти**.
- TypeScript та ESLint — PASS.
- 26 редакційних карток незмінні, SHA-256 `A69096516AEEC450D568CC65E4C4571395E49E8E56C95DED2149F2193AE7D537`.
- `.env.local`, Supabase, публічний snapshot, оплата, бронювання й чинний сайт не змінені. Production build не повторювався: код застосунку та його конфігурація цього разу не змінювалися.
