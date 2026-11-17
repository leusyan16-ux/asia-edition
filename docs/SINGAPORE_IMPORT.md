# Singapore supplied files — 29.10.2026

Опрацьовано два вкладення: таблицю з title/IMAGE formula/photo URL/activity URL та текстове збереження списку. Формули й сторонні інструкції не виконувались. Оригінали збережені приватно в `data/getyourguide-singapore/` (виключено з Git/Vercel).

## Результат

- Таблиця: 375 рядків, 374 activity-рядки, 299 унікальних GetYourGuide ID, 75 повторів. Одна URL — категорія Gardens by the Bay без activity ID; не створювали з неї екскурсію.
- Перетин із попередніми 849 GetYourGuide ID: 0.
- Додано 297 чернеток: 286 Singapore, 7 Indonesia, 4 Malaysia. Загалом у локальному робочому сховищі 1146 GetYourGuide-продуктів.
- Два ID 573141 та 825988 залишено поза імпортом: назва й activity slug описують Сінгапур, provider location у URL — Johor Bahru. Не вирішували суперечність здогадкою.
- Поїздки із Сінгапуру на Батам/у Джохор-Бару класифіковано за місцем активності, із збереженням Singapore у routeCountries та оригінального URL у метаданих.
- 233 продукти однозначно зіставлено з блоками другого файла. Збережено 196 цінових спостережень, 162 рейтинги (не перевірені комерційні дані). Дублікати назв та кілька акційних/пакетних сум не об’єднувались довільно; деталі в `preflight.json`.
- Оригінальних розгорнутих описів немає. Для нових 297 чернеток додано короткі редакційні RU/EN summaries на основі назв і напрямків. Не вигадували фактичних цін, включених послуг чи умов. П’ять невдалих машинних перекладів кварталів виправлено за наданими оригіналами.

## Фото

296 наданих URL → 296 успішних HTTP-завантажень та декодувань sharp, 0 помилок (`qa/singapore-photo-checks.json`). Одна картка, ID 289685 Universal Studios Singapore, не має фото URL у файлі; це відсутнє поле, не поломка наданого посилання.

Візуально перевірено шість репрезентативних фото: Marina Bay Sands SkyPark, Gardens by the Bay, світлове шоу, Big Bus, гастротур, Night Safari. Вони відповідають назвам (`qa/singapore-photos-review.png`). Повну змістову візуальну перевірку всіх 296 фото не заявляємо. Новий збір сторінок не виконувався.

## Безпека і перевірки

Мінімально адаптовано чинний TSV-парсер до 7 колонок і локалізованих URL `/uk-ua/`. Небезпечні формули залишаються текстом; `ranking_uuid/q` не впливають на ID. Додано зіставлення наданих Singapore/Indonesia/Malaysia place slugs. Виправлено хибне відхилення Singapore Little India/Chinatown як країн India/China: лише назви сінгапурських кварталів, явні маршрути до заборонених країн та РФ лишаються заблокованими.

94/94 тестів, TypeScript, ESLint і production build пройдено. 594 рендери RU/EN нових чернеток, repeat import 297 skip, 0 повторів. Попередні 849 записів порівняно цілком і збережено без змін. Контрольна сума 26 редакційних карток збігається з початковою. Перед імпортом і редакційними доповненнями створено резервні копії `.admin-local/before-*.backup.json`.

Артефакти: `import-reviewed/products.json`, `import-reviewed/admin-links.json`, `preflight.json`, `final-report.json`, `review-input.json`, `publication-worksheet.json`. Worksheet має publication/images/geography approval=false: він не надає дозволу на публікацію.

Нові 297 продуктів лишаються приватними чернетками. Публічний snapshot, Vercel, Supabase, бронювання, платежі та `.env.local` не змінені. Цей крок — імпорт і перевірка наданих матеріалів; production deployment нової партії не виконувався.

Для редактора: локальний development з ADMIN_MODE=local, TOUR_DATA_SOURCE=local, ADMIN_LOCAL_DIRECTORY=.admin-local; точні editor/preview посилання в `import-reviewed/admin-links.json`.
