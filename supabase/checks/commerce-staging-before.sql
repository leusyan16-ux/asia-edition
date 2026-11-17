-- Run ONLY in the new asia-edition-staging project's SQL Editor, as postgres.
-- Read-only preflight. This file neither creates nor changes database objects.
begin transaction read only;
select current_database() as database_name, current_user as actor, version() as server_version;
select to_regclass('auth.users') as auth_users,
       to_regprocedure('auth.uid()') as auth_uid,
       to_regprocedure('auth.jwt()') as auth_jwt;
select rolname from pg_roles where rolname in ('anon','authenticated') order by rolname;
-- Expected before first 008 application: zero commerce tables.
select schemaname, tablename from pg_tables
where schemaname='public' and tablename like 'commerce\_%' escape '\' order by tablename;
-- Inventory is optional and remains untouched by the standalone commerce installation.
select schemaname,count(*) from pg_tables
where schemaname in ('public','catalog_ingest','catalog_projection') group by schemaname;
commit;
