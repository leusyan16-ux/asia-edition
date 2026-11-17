-- OFFLINE preparation only. Apply after 001, 002, 003 with separate approval.
-- Ingestion workspace is private; promotion into normalized tours is deliberately separate.
begin;
alter table public.external_product_sources
 add column source_status text not null default 'active' check(source_status in ('active','missing','discontinued')),
 add column editorial_status text not null default 'pending' check(editorial_status in ('pending','approved','rejected')),
 add column content_rights_status text not null default 'unknown' check(content_rights_status in ('unknown','licensed','restricted')),
 add column publication_readiness text not null default 'blocked' check(publication_readiness in ('blocked','ready')),
 add column rights_evidence text check(rights_evidence ~ '^https://'),
 add constraint source_license_evidence check(content_rights_status<>'licensed' or rights_evidence is not null);
create index external_scope on public.external_product_sources(provider,(fact_snapshot->>'country'),tour_id);
create function public.guard_external_publication() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='published' and exists(select 1 from public.external_product_sources s where s.tour_id=new.id and
 (s.source_status<>'active' or s.editorial_status<>'approved' or s.content_rights_status<>'licensed' or s.publication_readiness<>'ready' or s.rights_evidence is null)) then
 raise exception 'External product requires editorial and rights approval'; end if;
 return new;
end $$;
revoke all on function public.guard_external_publication() from public,anon,authenticated;
create trigger external_publication_guard before insert or update of status on public.tours for each row execute function public.guard_external_publication();
-- Serialize source changes with publication on the parent row. Approval changes
-- revoke publication atomically; restoring approvals never republishes a tour.
create function public.revoke_external_publication() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  -- A source cannot be detached to make an external product look internal.
  -- The tours FK may still cascade when the parent has actually been deleted.
  if exists(select 1 from public.tours where id=old.tour_id) then
   raise exception 'External source cannot be detached from an existing tour';
  end if;
  return old;
 end if;
 if tg_op='UPDATE' and new.tour_id is distinct from old.tour_id then
  raise exception 'External source cannot be reassigned';
 end if;
 perform 1 from public.tours where id=new.tour_id for update;
 if tg_op='INSERT' then
  update public.tours set status='draft' where id=new.tour_id and status='published';
 elsif row(new.source_status,new.editorial_status,new.content_rights_status,new.publication_readiness,new.rights_evidence)
    is distinct from row(old.source_status,old.editorial_status,old.content_rights_status,old.publication_readiness,old.rights_evidence) then
  update public.tours set status='draft' where id=new.tour_id and status='published';
 end if;
 return new;
end $$;
revoke all on function public.revoke_external_publication() from public,anon,authenticated;
create trigger external_source_publication_guard before insert or update or delete on public.external_product_sources
 for each row execute function public.revoke_external_publication();
-- Existing 003 sources receive unapproved defaults above. Revoke any old
-- publication now, retaining all inventory, editorial content and verification.
update public.tours t set status='draft' where t.status='published' and exists(
 select 1 from public.external_product_sources s where s.tour_id=t.id and
 (s.source_status<>'active' or s.editorial_status<>'approved' or s.content_rights_status<>'licensed' or s.publication_readiness<>'ready' or s.rights_evidence is null));
create schema catalog_ingest;
revoke all on schema catalog_ingest from public,anon,authenticated;
create table catalog_ingest.jobs (
 id uuid primary key default gen_random_uuid(), provider text not null check(provider ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 snapshot_at timestamptz not null, countries text[] not null check(cardinality(countries) between 1 and 13),
 complete boolean not null default false, sealed boolean not null default false,
 state text not null default 'staging' check(state in ('staging','queued','running','retry','completed','failed','cancelled')),
 cursor integer not null default 0 check(cursor>=0), parts integer not null default 0 check(parts>=0),
 owner text, fence bigint not null default 0, lease_until timestamptz,
 attempts integer not null default 0, max_attempts integer not null default 5 check(max_attempts between 1 and 20),
 available_at timestamptz not null default now(), last_error text,
 created_at timestamptz not null default now(), finished_at timestamptz
);
create index ingest_claim on catalog_ingest.jobs(available_at,created_at) where state in ('queued','retry','running');
create table catalog_ingest.parts (
 job_id uuid not null references catalog_ingest.jobs(id), ordinal integer not null check(ordinal>=0),
 checksum text not null check(checksum ~ '^[a-f0-9]{64}$'),
 records jsonb not null check(jsonb_typeof(records)='array' and jsonb_array_length(records) between 1 and 250 and octet_length(records::text)<=8388608),
 primary key(job_id,ordinal)
);
create table catalog_ingest.products (
 id uuid primary key, provider text not null, external_product_id text not null check(length(external_product_id) between 1 and 200),
 country text not null references public.countries(slug),
 document jsonb not null check((jsonb_typeof(document)='object' and document->>'status'='draft') is true),
 revision bigint not null default 1, last_job uuid not null references catalog_ingest.jobs(id),
 unique(provider,external_product_id),
 check((document->'externalProduct'->>'provider'=provider) is true),
 check((document->'externalProduct'->>'external_product_id'=external_product_id) is true)
);
create unique index ingest_slug on catalog_ingest.products((document->>'slug'));
create index ingest_country on catalog_ingest.products(provider,country,id);
create index ingest_review on catalog_ingest.products((document->'externalProduct'->>'editorial_status'),(document->'externalProduct'->>'content_rights_status'),id);
create index ingest_source_search on catalog_ingest.products using gin(to_tsvector('simple',coalesce(document->'title'->>'ru','')||' '||coalesce(document->'title'->>'en','')));
create table catalog_ingest.packages (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references catalog_ingest.products(id),
 external_package_id text not null check(length(external_package_id) between 1 and 200),
 snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
 unique(product_id,external_package_id)
);
create table catalog_ingest.mappings (
 provider text not null, kind text not null check(kind in ('product','package','country','location','category')),
 parent_external_id text not null default '', external_id text not null, internal_id text not null,
 product_id uuid references catalog_ingest.products(id), package_id uuid references catalog_ingest.packages(id),
 check(kind<>'product' or (product_id is not null and internal_id=product_id::text)),
 check(kind<>'package' or (package_id is not null and internal_id=package_id::text)),
 primary key(provider,kind,parent_external_id,external_id)
);
create table catalog_ingest.events (
 id bigint generated always as identity primary key, job_id uuid not null references catalog_ingest.jobs(id),
 at timestamptz not null default now(), cursor integer not null, event text not null, details jsonb not null default '{}'
);
create index ingest_events_job on catalog_ingest.events(job_id,id);
-- Explicit revocation also neutralizes inherited default grants.
revoke all on all tables in schema catalog_ingest from public,anon,authenticated;
revoke all on all sequences in schema catalog_ingest from public,anon,authenticated;
alter table catalog_ingest.jobs enable row level security;
alter table catalog_ingest.parts enable row level security;
alter table catalog_ingest.products enable row level security;
alter table catalog_ingest.packages enable row level security;
alter table catalog_ingest.mappings enable row level security;
alter table catalog_ingest.events enable row level security;
-- No browser policies. Worker uses an explicitly provisioned server-only DB connection.
-- No login/role, password, service key or public SECURITY DEFINER endpoint is created here.
create function catalog_ingest.claim(worker text, seconds integer default 60) returns setof catalog_ingest.jobs
language plpgsql set search_path='' as $$
begin
 if length(worker) not between 1 and 100 or seconds not between 5 and 600 then raise exception 'Invalid lease'; end if;
 return query with candidate as (
  select id from catalog_ingest.jobs where sealed and attempts<max_attempts and
  ((state in ('queued','retry') and available_at<=clock_timestamp()) or (state='running' and lease_until<clock_timestamp()))
  order by created_at for update skip locked limit 1
 ) update catalog_ingest.jobs j set state='running',owner=worker,fence=j.fence+1,
 lease_until=clock_timestamp()+make_interval(secs=>seconds),attempts=j.attempts+1
 from candidate c where j.id=c.id returning j.*;
end $$;
revoke all on function catalog_ingest.claim(text,integer) from public,anon,authenticated;
commit;
