-- OPTIONAL LOCAL/DEPLOYMENT role provisioning, ONLY after migration 004.
-- Requires separate approval on any remote database. No password or login created.
-- A DBA must explicitly grant this role to a dedicated server connection later.
begin;
create role asia_catalog_worker nologin noinherit nobypassrls;
grant usage on schema catalog_ingest to asia_catalog_worker;
grant select,insert on catalog_ingest.jobs,catalog_ingest.parts,catalog_ingest.products,
 catalog_ingest.packages,catalog_ingest.mappings,catalog_ingest.events to asia_catalog_worker;
-- Sealed input packets and committed event records are append-only for worker.
grant update on catalog_ingest.jobs,catalog_ingest.products,catalog_ingest.packages,catalog_ingest.mappings to asia_catalog_worker;
-- USAGE supports nextval/currval; no direct sequence read or setval required.
grant usage on sequence catalog_ingest.events_id_seq to asia_catalog_worker;
grant execute on function catalog_ingest.claim(text,integer) to asia_catalog_worker;
create policy worker_jobs on catalog_ingest.jobs to asia_catalog_worker using(true) with check(true);
create policy worker_parts on catalog_ingest.parts to asia_catalog_worker using(true) with check(true);
create policy worker_products on catalog_ingest.products to asia_catalog_worker using(true) with check(document->>'status'='draft');
create policy worker_packages on catalog_ingest.packages to asia_catalog_worker using(true) with check(true);
create policy worker_mappings on catalog_ingest.mappings to asia_catalog_worker using(true) with check(true);
create policy worker_events on catalog_ingest.events to asia_catalog_worker using(true) with check(true);
-- No public inventory writes, administrator membership, auth access or DELETE grants.
commit;
