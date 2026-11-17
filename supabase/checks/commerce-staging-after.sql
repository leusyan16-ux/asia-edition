-- Read-only verification AFTER 008, only in asia-edition-staging.
begin transaction read only;
-- Expected: 17 tables, all RLS enabled.
select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and c.relname like 'commerce\_%' escape '\' order by c.relname;
select requests_enabled from public.commerce_settings where id=1; -- false until explicit staging request approval
-- Expected: 0 orders / 0 staff before test accounts and owner bootstrap.
select (select count(*) from public.commerce_orders) as orders,
       (select count(*) from public.commerce_staff) as staff;
select tablename,policyname,roles,cmd from pg_policies where schemaname='public' and tablename like 'commerce\_%' escape '\' order by tablename,policyname;
-- All commerce SECURITY DEFINER functions must have a fixed search_path.
select p.proname,p.prosecdef,p.proconfig,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'commerce\_%' escape '\' order by p.proname;
-- All four expected false. Customers may never directly create orders or staff.
select has_table_privilege('anon','public.commerce_orders','SELECT') as anon_orders,
       has_table_privilege('authenticated','public.commerce_orders','INSERT') as customer_insert_order,
       has_table_privilege('authenticated','public.commerce_staff','INSERT') as customer_insert_staff,
       has_table_privilege('authenticated','public.commerce_documents','INSERT') as customer_insert_document;
commit;
