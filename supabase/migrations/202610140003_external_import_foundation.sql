-- Optional future Supabase foundation. NOT applied by the local importer.
-- Execute only with separate approval, AFTER migrations 001 and 002.
begin;
create table public.external_product_sources (
 tour_id uuid primary key references public.tours(id) on delete cascade,
 provider text not null check(provider ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
 external_product_id text not null check(length(trim(external_product_id)) between 1 and 200),
 source_url text not null check(source_url ~ '^https://'),
 import_status text not null default 'needs_review' check(import_status in ('pending','needs_review','reviewed','failed')),
 last_synced_at timestamptz not null,
 test_data boolean not null default false,
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 fact_snapshot jsonb not null check(jsonb_typeof(fact_snapshot)='object'),
 commercial_snapshot jsonb not null check(jsonb_typeof(commercial_snapshot)='object'),
 locations jsonb not null default '[]' check(jsonb_typeof(locations)='array'),
 unique(provider,external_product_id)
);
create table public.catalog_import_batches (
 id uuid primary key default gen_random_uuid(),batch_id text not null unique check(length(batch_id) between 1 and 100),
 digest text not null,actor_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
 format text not null check(format in ('csv','json')),status text not null check(status in ('committed','rejected')),
 created_count integer not null check(created_count>=0),updated_count integer not null check(updated_count>=0),
 skipped_count integer not null check(skipped_count>=0),failed_count integer not null check(failed_count>=0),
 results jsonb not null check(jsonb_typeof(results)='array')
);
alter table public.external_product_sources enable row level security;
alter table public.catalog_import_batches enable row level security;
revoke all on public.external_product_sources,public.catalog_import_batches from public,anon,authenticated;
grant select on public.external_product_sources,public.catalog_import_batches to authenticated;
create policy source_admin_read on public.external_product_sources for select to authenticated using(public.is_inventory_admin());
create policy import_admin_read on public.catalog_import_batches for select to authenticated using(public.is_inventory_admin());
-- No client write policies or write RPCs: the Supabase importer remains disabled.
commit;
