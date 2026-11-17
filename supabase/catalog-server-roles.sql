-- Separate operator-approved provisioning; no passwords and no enabled logins here.
-- Apply AFTER migrations 001..007 and catalog-worker-role.sql, never as browser code.
begin;
create role asia_reader_login nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role asia_editor_login nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role asia_worker_login nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant asia_catalog_reader to asia_reader_login;
grant asia_catalog_editor to asia_editor_login;
grant asia_catalog_worker to asia_worker_login;
-- A DBA enables LOGIN and assigns distinct generated secrets out-of-band.
-- Do not grant these memberships to authenticator/anon/authenticated.
commit;
