# ASIA EDITION — застосування SQL через Supabase SQL Editor

2026-10-22. Інструкція для відновленого staging-проєкту. Власник повідомив про 0 рядків у перевірках таблиць, asia-ролей, public-типів, Storage buckets/policies. Віддалений стан агентом не перевірявся; нічого віддалено не застосовано. `.env.local`, SQL-джерела і 26 локальних редакційних карток не змінено.

## Висновок аудиту та ризики ДО початку

- 001–007, `catalog-worker-role.sql`, `catalog-server-roles.sql` і `storage-private.sql` узгоджені за залежностями. Повторний локальний набір SQL/RLS/Storage — **22/22** успішно на ізольованому PGlite. Це не перевірка managed Supabase і не гарантія привілеїв його ролі postgres.
- Окремо перевірено всі **15 SQL-блоків цієї інструкції** та виконання **10 файлів у наведеному порядку** на новій in-memory PGlite з локальними managed-schema stubs. Після кожного кроку збіглися кількості таблиць і RLS=true. Продуктів у цьому проході не створювали. Stubs — лише деталь локальної перевірки, не інструкція для Supabase.
- Немає DROP TABLE/TRUNCATE/видалення наявних Auth-користувачів чи Storage-об’єктів під час застосування. 002 замінює policy `published_tours` з 001 у тій самій транзакції. DELETE у тілі `admin_save_batch` виконується лише при подальшому виклику функції з правами адміністратора, не при створенні функції. Функції видалення фотографій під час міграцій не викликаються.
- Файли мають власні BEGIN/COMMIT і не є повторюваними міграціями: успішно застосований файл вдруге не запускати. Помилка одного файла не відкочує попередні успішні файли.
- Порожні таблиці не виключають порожніх схем, функцій або інших конфліктів імен. Preflight нижче обов’язковий. Службові `auth`, `storage`, `anon`, `authenticated` мають уже існувати від Supabase: не створювати їх локальними stubs.
- **Не запускати `storage-admin.sql`**: він створює legacy public bucket `tour-images`. Обрано тільки private-контур. `storage-private.sql` навмисно відмовить, якщо bucket уже public або існують будь-які object policies. Не видаляти політики для обходу цієї відмови.
- Через SQL Editor Supabase CLI migration history автоматично не ведеться. Зберегти журнал filename/час/результат; надалі не запускати `db push` без окремого узгодження історії. [Офіційна документація](https://supabase.com/docs/guides/deployment/database-migrations).

## 0. Підготовка й додатковий read-only preflight

1. Переконатися, що відкрито правильний Project Reference; позначити проєкт як staging у власному журналі. Не робити Reset Database.
2. Перевірити, що до цього проєкту не підключено старий застосунок, який може паралельно змінювати схему/дані. Зберегти перелік і кількість наявних Auth-користувачів та інформацію про інші схеми. Якщо дані є — підготувати їхній backup окремим погодженим способом до DDL. Не експортувати паролі/токени у чат.
3. SQL Editor → New query. Обрати роль `postgres`, primary database. Усі наведені тут перевірки виконувати окремими запитами від цієї ролі; не використовувати app reader/editor для міграцій.
4. Виконати **тільки** цей preflight:

```sql
select current_database() as db, current_user as executing_role,
       current_setting('server_version') as postgres_version,
       current_setting('server_version_num')::integer >= 150000 as version_ok,
       (select rolcreaterole or rolsuper from pg_roles
        where rolname=current_user) as can_create_roles,
       has_database_privilege(current_user,current_database(),'CREATE') as can_create_schemas,
       has_schema_privilege(current_user,'public','CREATE') as can_create_public_objects,
       to_regclass('auth.users') is not null as auth_users_exists,
       to_regprocedure('auth.uid()') is not null as auth_uid_exists,
       (select count(*)=2 from pg_roles
        where rolname in ('anon','authenticated')) as browser_roles_exist,
       to_regnamespace('catalog_ingest') is null as ingest_schema_absent,
       to_regnamespace('catalog_projection') is null as projection_schema_absent;
```

Очікування: `executing_role=postgres`, усі boolean — true. PostgreSQL <15 потребує окремого перегляду; не оновлювати БД автоматично. [Supabase postgres не є повним superuser](https://supabase.com/docs/guides/database/postgres/roles-superuser), тому правами не слід нехтувати.

```sql
select n.nspname,c.relname,c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='storage' and c.relname in ('buckets','objects');

select has_table_privilege(current_user,'storage.buckets','INSERT') as can_create_bucket;

select p.proname,pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public';
```

Перший SELECT запускати самостійно: мають існувати buckets та objects, у objects `relrowsecurity=true`. Другий — true. Третій: існуючі функції потрібно зіставити з назвами функцій у файлах 001–004; не видаляти їх. Попередні перевірки таблиць/asia-ролей/public-типів/buckets/policies мають залишатися порожніми; перевіряти кожен SELECT окремо — результат лише останнього запиту не підтверджує інші.

Якщо будь-яка умова не виконана — зупинитися **до 001** і зберегти результат для аналізу.

## 1. Як застосовувати кожний файл

Для кожного кроку: відкрити точний локальний файл → скопіювати весь текст включно з BEGIN/COMMIT → створити окрему SQL Editor query із назвою файла → переконатися, що немає виділеного уривка → Run один раз → зберегти результат → запустити SELECT-перевірки нижче. Не об’єднувати файли й перевірки в одну велику відправку. Не натискати Run повторно лише через `Success. No rows returned`: для DDL це нормальний результат.

Позначення 001–007 нижче — суфікси точних імен у таблиці, не команда для запуску всього каталогу.

| Крок | Повний локальний файл | Залежність | Очікувані таблиці після кроку public / catalog_ingest / catalog_projection |
|---|---|---|---|
| 1 | [202610100001_tour_inventory.sql](../supabase/migrations/202610100001_tour_inventory.sql) | Managed Supabase + preflight | 15 / 0 / 0 |
| 2 | [202610100002_admin.sql](../supabase/migrations/202610100002_admin.sql) | 001, auth.users, auth.uid() | 18 / 0 / 0 |
| 3 | [202610140003_external_import_foundation.sql](../supabase/migrations/202610140003_external_import_foundation.sql) | 001–002 | 20 / 0 / 0 |
| 4 | [202610180004_catalog_worker.sql](../supabase/migrations/202610180004_catalog_worker.sql) | 003 + countries | 20 / 6 / 0 |
| 5 | [catalog-worker-role.sql](../supabase/catalog-worker-role.sql) | 004: tables + claim() | 20 / 6 / 0 |
| 6 | [202610180005_catalog_projection.sql](../supabase/migrations/202610180005_catalog_projection.sql) | 004 + worker-role | 20 / 6 / 2 |
| 7 | [202610180006_local_uploads_media.sql](../supabase/migrations/202610180006_local_uploads_media.sql) | 005 + три catalog-ролі | 20 / 7 / 5 |
| 8 | [202610220007_launch_workflows.sql](../supabase/migrations/202610220007_launch_workflows.sql) | 005–006, operators | 20 / 7 / 6 |
| 9 | [catalog-server-roles.sql](../supabase/catalog-server-roles.sql) | Три catalog-ролі; рекомендовано після 007 | 20 / 7 / 6 |
| 10 | [storage-private.sql](../supabase/storage-private.sql) | Managed Storage, preflight без policies/buckets | 20 / 7 / 6 + один private bucket |

Назви файлів 005/006 мають історичні коментарі local/offline: вони не містять PGlite bootstrap або створення managed auth/storage. За цією інструкцією застосовуються тільки після погодження власником.

## 2. Спільна перевірка ПІСЛЯ КОЖНОГО успішного файла

```sql
select n.nspname as schema_name,
       count(*)::integer as tables,
       bool_and(c.relrowsecurity) as all_rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','catalog_ingest','catalog_projection')
  and c.relkind in ('r','p')
group by n.nspname order by n.nspname;
```

Кількості мають збігатися з таблицею кроків, усі `all_rls_enabled=true`. Схема без таблиць не повертає рядка (це значення 0). Не продовжувати при розбіжностях.

## 3. Спеціальні перевірки кожного кроку

Наведені під кожним номером SELECT виконувати лише після відповідного файла, окремо від міграції.

### Після 1 — inventory

```sql
select (select count(*) from public.countries) as countries,
       (select count(*) from public.categories) as categories,
       (select count(*) from public.tours) as tours,
       to_regprocedure('public.tour_detail(text)') is not null as detail_rpc,
       to_regprocedure('public.tour_catalog(jsonb)') is not null as catalog_rpc;
```

Очікування: **13 / 5 / 0 / true / true**. Міграція створює лише seed країн/категорій, не екскурсії чи міста.

### Після 2 — admin

```sql
select (select count(*) from public.admin_members) as administrators,
       to_regprocedure('public.admin_save_batch(jsonb,jsonb)') is not null as save_rpc,
       has_table_privilege('authenticated','public.admin_members','INSERT') as self_assign_admin;
```

Очікування: **0 / true / false**. Ролі адміністраторів ще не призначати. Визначення `published_tours` у `pg_policies` тепер має враховувати visible/archived.

### Після 3 — private external sources

```sql
select to_regclass('public.external_product_sources') is not null as sources,
       to_regclass('public.catalog_import_batches') is not null as batches,
       has_table_privilege('anon','public.external_product_sources','SELECT') as anonymous_source_access;
```

Очікування: **true / true / false**.

### Після 4 — ingestion

```sql
select to_regprocedure('catalog_ingest.claim(text,integer)') is not null as claim_exists,
       has_schema_privilege('anon','catalog_ingest','USAGE') as anonymous_ingest_access;
```

Очікування: **true / false**; шість таблиць ingestion, RLS=true. Worker поки не запускати.

### Після 5 — worker role

```sql
select rolname,rolcanlogin,rolsuper,rolbypassrls,rolinherit
from pg_roles where rolname='asia_catalog_worker';

select has_table_privilege('asia_catalog_worker','catalog_ingest.products','INSERT') as can_import,
       has_table_privilege('asia_catalog_worker','catalog_ingest.products','DELETE') as can_delete;
```

Очікування: одна роль, всі boolean у першому SELECT false; **true / false** у другому. Worker products policy дозволяє запис лише document.status=draft.

### Після 6 — projection

```sql
select rolname,rolcanlogin,rolsuper,rolbypassrls,rolinherit
from pg_roles where rolname in ('asia_catalog_reader','asia_catalog_editor');

select (select count(*) from catalog_projection.documents) as documents,
       to_regprocedure('catalog_projection.review(uuid,text,text,text,text,text)') is not null as review_exists;
```

Очікування: дві ролі, всі boolean false; **0 / true**. Policy `reader_published` — using(public_visible). Editor має окрему policy, browser-ролям schema не відкрита.

### Після 7 — uploads/media/publication guard

```sql
select to_regclass('catalog_ingest.uploads') is not null as uploads,
       to_regclass('catalog_projection.media_assets') is not null as assets,
       to_regclass('catalog_projection.media_links') is not null as links,
       to_regclass('catalog_projection.publication_permissions') is not null as permissions,
       has_table_privilege('asia_catalog_editor','catalog_projection.publication_permissions','INSERT') as editor_direct_permission_write;
```

Очікування: **true / true / true / true / false**. RLS publication_permissions увімкнено; відсутність direct policies для цієї таблиці навмисна — наступний крок додає контрольовану функцію, а не browser write.

Для актуальної 006 додатково виконати тільки SELECT:

```sql
select to_regprocedure('catalog_projection.review_media(text,text,text)') is not null as media_review_exists,
       has_function_privilege('asia_catalog_editor','catalog_projection.review_media(text,text,text)','EXECUTE') as editor_can_review,
       has_function_privilege('authenticated','catalog_projection.review_media(text,text,text)','EXECUTE') as browser_can_review;
```

Очікування: **true / true / false**. Права на керовані фото підтверджуються окремо від прав на продукт. Якщо до 006 існували опубліковані імпорти, вони стануть чернетками зі збереженням контенту. Фото та publication permissions цими SELECT не змінюються. Уже застосований старіший варіант 006 не запускати повторно: спочатку окремо погодити сумісне оновлення.

### Після 8 — inquiries/explicit publication

```sql
select to_regclass('catalog_projection.inquiries') is not null as inquiries,
       has_table_privilege('asia_catalog_reader','catalog_projection.inquiries','SELECT') as reader_sees_contacts,
       has_function_privilege('authenticated','catalog_projection.authorize_publication(uuid,text,text)','EXECUTE') as browser_can_publish,
       has_function_privilege('asia_catalog_editor','catalog_projection.authorize_publication(uuid,text,text)','EXECUTE') as server_editor_can_authorize;
```

Очікування: **true / false / false / true**. Функцію authorize_publication **не викликати**. Таблиця inquiries порожня, продуктів не створено.

### Після 9 — server login wrappers

```sql
select rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolinherit
from pg_roles
where rolname in ('asia_reader_login','asia_editor_login','asia_worker_login')
order by rolname;

select pg_has_role('asia_reader_login','asia_catalog_reader','MEMBER') as reader_membership,
       pg_has_role('asia_editor_login','asia_catalog_editor','MEMBER') as editor_membership,
       pg_has_role('asia_worker_login','asia_catalog_worker','MEMBER') as worker_membership;
```

Очікування: три ролі, усі boolean у першому SELECT false; **true / true / true** у другому. LOGIN/паролі налаштовуються окремим наступним погодженим кроком; зараз зберігати NOLOGIN.

### Після 10 — private Storage

```sql
select id,name,public,file_size_limit,allowed_mime_types
from storage.buckets where id='asia-private-media';

select count(*) as object_policies
from pg_policies where schemaname='storage' and tablename='objects';
```

Очікування: bucket `asia-private-media`, **public=false**, **8388608**, **{image/webp}**; object_policies **0**. У Dashboard Storage він має бути Private. JPG/PNG завантаження app попередньо перекодовує у WebP. Порожні browser policies не заважають запланованому server proxy; його реальну інтеграцію перевірятимемо окремо.

## 4. Фінальні перевірки без запису продуктів

```sql
select (select count(*) from public.tours) as normalized_tours,
       (select count(*) from catalog_ingest.products) as imported_products,
       (select count(*) from catalog_projection.documents) as projected_products,
       (select count(*) from catalog_projection.publication_permissions) as publication_permissions,
       (select count(*) from catalog_projection.inquiries) as inquiries;
```

Очікування: **0 / 0 / 0 / 0 / 0**. Разом **33 таблиці** (20 public, 7 ingestion, 6 projection), RLS усюди true, **6 asia-ролей**, **1 private bucket**. Auth-користувачів повинно залишитися стільки ж, скільки до початку; таблиці auth не пересоздавалися.

```sql
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies
where schemaname in ('public','catalog_ingest','catalog_projection')
order by schemaname,tablename,policyname;
```

Зберегти цей ACL/RLS inventory та журнал кроків. Перевірка порожніх таблиць не доводить поведінку RLS на майбутніх даних: native login, TLS, private Storage read/write і захищені чернетки перевіряються окремим наступним етапом. Зараз ні тестових продуктів, ні публікацій на remote не виконувати.

## Якщо виникла помилка

- Негайно зупинитися, не запускати наступний файл. Зберегти filename, error code і повідомлення без секретів.
- Не видаляти існуючі об’єкти, не додавати IF NOT EXISTS для приховування конфлікту, не робити reset.
- Якщо SQL Editor повідомляє про aborted/open transaction, завершити саме невдалу транзакцію `ROLLBACK;`, потім перевірити об’єкти. Не вважати success наступного SELECT доказом commit попереднього DDL.
- Після відмови storage-private не видаляти policies і не перемикати bucket у public.
- Попередні успішні файли залишаються застосованими. Продовження або повтор невдалого файла — тільки після аналізу фактичного стану; усе від 001 не повторювати.
- Попередження Dashboard про destructive SQL для 002 може стосуватися навмисного DROP POLICY чи DELETE всередині функції. Перевірити відповідність саме локальному файлу; не підтверджувати невідомі додаткові операції.

На цьому зупинитися: не змінювати .env.local, не вмикати remote adapter/worker, не призначати publication permissions, не переносити 26 карток. Наступний крок — окреме підтвердження налаштування обмежених підключень.
