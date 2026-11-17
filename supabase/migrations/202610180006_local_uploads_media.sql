-- Offline/local migration after 005. No remote execution authorized.
begin;
create table catalog_ingest.uploads (
 id uuid primary key default gen_random_uuid(),digest text not null unique check(digest ~ '^[a-f0-9]{64}$'),
 actor text not null, filename text not null, format text not null check(format in ('csv','json')),
 job_id uuid references catalog_ingest.jobs(id),state text not null check(state in ('preparing','prepared','failed')),
 preview jsonb not null default '{}',created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table catalog_ingest.uploads enable row level security;
revoke all on catalog_ingest.uploads from public,anon,authenticated;
grant select,insert,update on catalog_ingest.uploads to asia_catalog_worker;
grant select on catalog_ingest.uploads to asia_catalog_editor;
create policy worker_uploads on catalog_ingest.uploads to asia_catalog_worker using(true) with check(true);
create policy editor_uploads on catalog_ingest.uploads for select to asia_catalog_editor using(true);
create function catalog_ingest.claim_specific(target uuid,worker text) returns setof catalog_ingest.jobs language plpgsql set search_path='' as $$
begin
 if target is null or worker is null or length(trim(worker)) not between 1 and 100 then raise exception 'Invalid worker claim';end if;
 update catalog_ingest.jobs set state='failed',last_error='Lease retry budget exhausted' where id=target and state='running' and lease_until<clock_timestamp() and attempts>=max_attempts;
 return query with candidate as (select id from catalog_ingest.jobs where id=target and sealed and attempts<max_attempts and ((state in ('queued','retry') and available_at<=clock_timestamp()) or (state='running' and lease_until<clock_timestamp())) for update skip locked)
 update catalog_ingest.jobs j set state='running',owner=worker,fence=j.fence+1,attempts=j.attempts+1,lease_until=clock_timestamp()+interval '60 seconds' from candidate c where j.id=c.id returning j.*;
end $$;
revoke all on function catalog_ingest.claim_specific(uuid,text) from public,anon,authenticated;
grant execute on function catalog_ingest.claim_specific(uuid,text) to asia_catalog_worker;
create function catalog_projection.slug_owners(slugs text[]) returns table(slug text,provider text,external_product_id text) language sql stable security definer set search_path='' as $$
 select p.document->>'slug',p.provider,p.external_product_id from catalog_ingest.products p where p.document->>'slug'=any(slugs)
 union select d.slug,p.provider,p.external_product_id from catalog_projection.documents d left join catalog_ingest.products p on p.id=d.source_id where d.slug=any(slugs)
$$;
revoke all on function catalog_projection.slug_owners(text[]) from public,anon,authenticated;
grant execute on function catalog_projection.slug_owners(text[]) to asia_catalog_worker;
grant usage on schema catalog_projection to asia_catalog_worker;

create table catalog_projection.media_assets (
 id uuid primary key,key text not null unique check(key=id::text||'.webp'),
 bytes integer not null check(bytes between 1 and 8388608),sha256 text not null,
 actor text not null,created_at timestamptz not null default now(),retired_at timestamptz,
 storage_backend text not null default 'local' check(storage_backend in ('local','supabase')),
 content_rights_status text not null default 'unknown' check(content_rights_status in ('unknown','licensed','restricted')),
 rights_evidence text check(rights_evidence ~ '^https://[^/[:space:]]+'),
 check(content_rights_status<>'licensed' or rights_evidence is not null)
);
create table catalog_projection.media_links (
 product_id uuid not null references catalog_projection.documents(id),asset_id uuid not null references catalog_projection.media_assets(id),
 active boolean not null default true,primary key(product_id,asset_id)
);
create index media_asset_links on catalog_projection.media_links(asset_id) where active;
alter table catalog_projection.media_assets enable row level security;
alter table catalog_projection.media_links enable row level security;
revoke all on catalog_projection.media_assets,catalog_projection.media_links from public,anon,authenticated;
grant select,insert on catalog_projection.media_assets to asia_catalog_editor;
grant select on catalog_projection.media_links to asia_catalog_editor;
create policy editor_assets on catalog_projection.media_assets to asia_catalog_editor using(true) with check(true);
create policy editor_links on catalog_projection.media_links for select to asia_catalog_editor using(true);

-- 005 could already contain published imports. New permissions start empty:
-- revoke publication before installing gallery validation, retaining even legacy
-- private image references whose files/assets still need a separate transfer.
update catalog_projection.documents d set document=d.document||jsonb_build_object('status','draft','updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),revision=d.revision+1
where d.status='published' and (d.source_id is not null or (d.document->'externalProduct' is not null and d.document->'externalProduct'<>'null'::jsonb));

create function catalog_projection.local_media_key(url text) returns text language plpgsql immutable set search_path='' as $$
declare decoded text; bytes bytea='';i int=1;ch text;
begin
 if url is null then return null;end if;
 while i<=length(url) loop
  ch=substring(url from i for 1);
  if ch='%' then
   if substring(url from i+1 for 2)!~'^[0-9A-Fa-f]{2}$' then return '*';end if;
   bytes=bytes||decode(substring(url from i+1 for 2),'hex');i=i+3;
  else bytes=bytes||convert_to(ch,'UTF8');i=i+1;end if;
 end loop;
 decoded=split_part(split_part(convert_from(bytes,'UTF8'),'?',1),'#',1);
 if decoded !~ '^/images/admin/[a-f0-9-]{36}\.webp$' then
  return case when decoded ilike '%/images/admin%' or decoded ilike '%/admin/api/images%' then '*' else null end;
 end if;
 return substring(decoded from 15);
exception when others then return '*';
end $$;
create function catalog_projection.link_media() returns trigger language plpgsql security definer set search_path='' as $$
declare image jsonb;asset uuid;name text;
begin
 if not exists(select 1 from jsonb_array_elements(coalesce(new.document->'images','[]')) entries(value) where catalog_projection.local_media_key(entries.value->>'url') is not null) and not exists(select 1 from catalog_projection.media_links where product_id=new.id and active) then return new;end if;
 perform pg_advisory_xact_lock(72619484);
 update catalog_projection.media_links set active=false where product_id=new.id and active;
 for image in select value from jsonb_array_elements(coalesce(new.document->'images','[]')) loop
  name=catalog_projection.local_media_key(image->>'url');
  if name is not null then
   if image->>'url' is distinct from '/images/admin/'||name then raise exception 'Use canonical gallery image URL';end if;
   select id into asset from catalog_projection.media_assets where key=name and retired_at is null for share;
   if asset is null then raise exception 'Gallery image is missing or retired';end if;
   if new.document->>'status'='published' and not exists(select 1 from catalog_projection.media_assets where id=asset and content_rights_status='licensed' and rights_evidence is not null) then raise exception 'Gallery image requires confirmed content rights';end if;
   insert into catalog_projection.media_links(product_id,asset_id) values(new.id,asset) on conflict(product_id,asset_id) do update set active=true;
  end if;
 end loop;
 return new;
end $$;
create trigger link_media after insert or update of document on catalog_projection.documents for each row execute function catalog_projection.link_media();

create function catalog_projection.retire_media(name text) returns void language plpgsql security definer set search_path='' as $$
begin
 if name !~ '^[a-f0-9-]{36}\.webp$' or name is null then raise exception 'Invalid media key';end if;
 perform pg_advisory_xact_lock(72619484);
 if exists(select 1 from catalog_projection.media_links l join catalog_projection.media_assets a on a.id=l.asset_id where a.key=name and l.active) then raise exception 'Сначала сохраните карточку без фотографии';end if;
 -- Scan canonical JSONB, including immutable source snapshots and queued packets.
 if exists(select 1 from (
  select document payload from catalog_projection.documents union all
  select document from catalog_ingest.products union all select records from catalog_ingest.parts
 ) objects cross join lateral jsonb_path_query(payload,'$.**.url') reference
 where catalog_projection.local_media_key(reference#>>'{}') in (name,'*')) then raise exception 'Фотография используется в карточке или данных импорта';end if;
 update catalog_projection.media_assets set retired_at=clock_timestamp() where key=name and retired_at is null;
 -- Bytes are retained. Physical purge is deliberately not implemented.
end $$;
create function catalog_projection.media_visible(name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from catalog_projection.media_assets a join catalog_projection.media_links l on l.asset_id=a.id join catalog_projection.documents d on d.id=l.product_id where a.key=name and a.retired_at is null and a.content_rights_status='licensed' and a.rights_evidence is not null and l.active and d.public_visible)
$$;
-- Editors may review rights, but cannot rewrite asset identity, bytes or retirement.
-- A rights/evidence change revokes publication; reapproval never republishes.
create function catalog_projection.review_media(name text,rights text,evidence text) returns void language plpgsql security definer set search_path='' as $$
declare asset catalog_projection.media_assets;
begin
 if name is null or name !~ '^[a-f0-9-]{36}\.webp$' or rights is null or rights not in ('unknown','licensed','restricted') then raise exception 'Invalid media review';end if;
 if evidence is not null and evidence !~ '^https://[^/[:space:]]+' then raise exception 'HTTPS rights evidence required';end if;
 if rights='licensed' and evidence is null then raise exception 'Rights evidence required';end if;
 perform pg_advisory_xact_lock(72619484);
 select * into asset from catalog_projection.media_assets where key=name and retired_at is null for update;
 if not found then raise exception 'Gallery image is missing or retired';end if;
 if row(asset.content_rights_status,asset.rights_evidence) is distinct from row(rights,evidence) then
  update catalog_projection.media_assets set content_rights_status=rights,rights_evidence=evidence where id=asset.id;
  update catalog_projection.documents d set document=d.document||jsonb_build_object('status','draft','updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),revision=d.revision+1
  where d.status='published' and exists(select 1 from catalog_projection.media_links l where l.product_id=d.id and l.asset_id=asset.id and l.active);
 end if;
end $$;

create table catalog_projection.publication_permissions (
 product_id uuid primary key references catalog_projection.documents(id),approved_revision bigint not null,source_revision bigint not null,
 actor text not null,approved_at timestamptz not null default now()
);
alter table catalog_projection.publication_permissions enable row level security;
revoke all on catalog_projection.publication_permissions from public,anon,authenticated,asia_catalog_editor,asia_catalog_reader,asia_catalog_worker;
create function catalog_projection.guard_publication_permission() returns trigger language plpgsql security definer set search_path='' as $$
begin
 -- The editor has table UPDATE rights; do not let it rewind a consumed revision.
 if TG_OP='UPDATE' and new.revision<old.revision then raise exception 'Document revision cannot decrease';end if;
 if (new.source_id is not null or (new.document->'externalProduct' is not null and new.document->'externalProduct'<>'null'::jsonb)) and new.document->>'status'='published' then
  if TG_OP='INSERT' or not exists(select 1 from catalog_projection.publication_permissions p where p.product_id=new.id and p.approved_revision=old.revision and p.source_revision=new.source_revision) then raise exception 'Публикация импорта отключена: отдельное разрешение не выдано';end if;
  if new.revision<>old.revision+1 or (new.document-array['status','visible','updatedAt']) is distinct from (old.document-array['status','visible','updatedAt']) then raise exception 'Publication must use the approved document revision';end if;
 end if;
 -- Every edit must invalidate any permission bound to the previous revision,
 -- including direct SQL updates that do not use the application save helper.
 if TG_OP='UPDATE' and new.revision<>old.revision+1 then raise exception 'Document revision must increase by one';end if;
 return new;
end $$;
create trigger publication_permission before insert or update on catalog_projection.documents for each row execute function catalog_projection.guard_publication_permission();
revoke all on function catalog_projection.local_media_key(text),catalog_projection.link_media(),catalog_projection.retire_media(text),catalog_projection.media_visible(text),catalog_projection.review_media(text,text,text),catalog_projection.guard_publication_permission() from public,anon,authenticated;
grant execute on function catalog_projection.retire_media(text) to asia_catalog_editor;
grant execute on function catalog_projection.review_media(text,text,text) to asia_catalog_editor;
grant execute on function catalog_projection.media_visible(text) to asia_catalog_reader,asia_catalog_editor;
commit;
