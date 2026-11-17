-- Offline/local only until separately approved. After 004 and worker role file.
begin;
create schema catalog_projection;
revoke all on schema catalog_projection from public,anon,authenticated;
create table catalog_projection.documents (
 id uuid primary key,
 source_id uuid unique references catalog_ingest.products(id),
 source_revision bigint,
 document jsonb not null check(jsonb_typeof(document)='object'),
 missing jsonb not null default '[]',
 slug text generated always as (document->>'slug') stored unique,
 country text generated always as (document->>'country') stored references public.countries(slug),
 location text generated always as (document->>'location') stored,
 category text generated always as (document->>'category') stored,
 status text generated always as (document->>'status') stored,
 archived boolean generated always as (coalesce((document->>'archived')::boolean,false)) stored,
 featured boolean generated always as (coalesce((document->>'featured')::boolean,false)) stored,
 duration_minutes integer generated always as ((document->>'durationMinutes')::integer) stored,
 price_snapshot jsonb generated always as (document->'prices') stored,
 source_locations jsonb generated always as (coalesce(document->'externalProduct'->'locations','[]')) stored,
 search_text text generated always as (lower(coalesce(document->'title'->>'ru','')||' '||coalesce(document->'title'->>'en','')||' '||coalesce(document->'summary'->>'ru','')||' '||coalesce(document->'summary'->>'en',''))) stored,
 admin_search text generated always as (lower(coalesce(document->'title'->>'ru','')||' '||coalesce(document->'title'->>'en','')||' '||coalesce(document->>'slug',''))) stored,
 public_visible boolean generated always as (document->>'status'='published' and coalesce((document->>'visible')::boolean,false) and not coalesce((document->>'archived')::boolean,true) and (document->>'verifiedAt' is not null or (document->>'isDemo')::boolean)) stored,
 revision bigint not null default 1,
 check((document->>'id'=id::text) is true),
 check(status in ('draft','published','unavailable'))
);
create index projection_browse on catalog_projection.documents(country,location,category,slug) where public_visible;
create index projection_admin on catalog_projection.documents(country,status,id);
create index projection_sort on catalog_projection.documents(featured desc,slug collate "C") where public_visible;
create table catalog_projection.audit (
 id bigint generated always as identity primary key, product_id uuid not null references catalog_projection.documents(id),
 actor text not null, event text not null, at timestamptz not null default clock_timestamp()
);
alter table catalog_projection.documents enable row level security;
alter table catalog_projection.audit enable row level security;
revoke all on all tables in schema catalog_projection from public,anon,authenticated;
revoke all on all sequences in schema catalog_projection from public,anon,authenticated;
create role asia_catalog_reader nologin noinherit nobypassrls;
create role asia_catalog_editor nologin noinherit nobypassrls;
grant usage on schema catalog_projection to asia_catalog_reader,asia_catalog_editor;
grant select on catalog_projection.documents to asia_catalog_reader,asia_catalog_editor;
grant insert,update on catalog_projection.documents to asia_catalog_editor;
grant select,insert on catalog_projection.audit to asia_catalog_editor;
grant usage,select on all sequences in schema catalog_projection to asia_catalog_editor;
create policy reader_published on catalog_projection.documents for select to asia_catalog_reader using(public_visible);
create policy editor_documents on catalog_projection.documents to asia_catalog_editor using(true) with check(true);
create policy editor_audit on catalog_projection.audit to asia_catalog_editor using(true) with check(true);
grant usage on schema catalog_ingest to asia_catalog_editor;
grant select on catalog_ingest.jobs,catalog_ingest.events to asia_catalog_editor;
create policy editor_jobs_read on catalog_ingest.jobs for select to asia_catalog_editor using(true);
create policy editor_events_read on catalog_ingest.events for select to asia_catalog_editor using(true);

create function catalog_projection.missing_fields(d jsonb) returns jsonb language sql immutable set search_path='' as $$
select coalesce(jsonb_agg(message),'[]') from (
 select 'Добавьте фотографию' message where jsonb_array_length(coalesce(d->'images','[]'))=0
 union all select 'Укажите длительность' where d->>'durationMinutes' is null
 union all select 'Подтвердите оператора и дату проверки экскурсии' where not coalesce((d->>'isDemo')::boolean,false) and (d->>'verifiedAt' is null or d->'operator'='null')
 union all select 'Название '||upper(l) from unnest(array['ru','en']) l where coalesce(trim(d->'title'->>l),'')=''
 union all select 'Описание '||upper(l) from unnest(array['ru','en']) l where not exists(select 1 from jsonb_array_elements_text(coalesce(d->'description'->l,'[]')) p where trim(p)<>'')
) errors
$$;
revoke all on function catalog_projection.missing_fields(jsonb) from public,anon,authenticated;
grant execute on function catalog_projection.missing_fields(jsonb) to asia_catalog_editor;

create function catalog_projection.guard_editor() returns trigger language plpgsql set search_path='' as $$
begin
 if new.document->>'status'='published' and jsonb_array_length(catalog_projection.missing_fields(new.document))>0 then raise exception 'Publication requires complete verified content';end if;
 if current_user='asia_catalog_editor' then
  if TG_OP='INSERT' and (new.source_id is not null or new.document->'externalProduct'<>'null'::jsonb) then raise exception 'Source metadata is managed by worker'; end if;
  if TG_OP='UPDATE' and (new.source_id is distinct from old.source_id or new.source_revision is distinct from old.source_revision or new.document->'externalProduct' is distinct from old.document->'externalProduct') then raise exception 'Source metadata is immutable'; end if;
 end if;
 if new.document->>'status'='published' and new.document->'externalProduct'<>'null'::jsonb then
  if coalesce(new.document->'externalProduct'->>'source_status','')<>'active' or coalesce(new.document->'externalProduct'->>'editorial_status','')<>'approved' or coalesce(new.document->'externalProduct'->>'content_rights_status','')<>'licensed' or coalesce(new.document->'externalProduct'->>'publication_readiness','')<>'ready' or new.document->'externalProduct'->>'rights_evidence' is null then raise exception 'External publication blocked'; end if;
 end if;
 return new;
end $$;
revoke all on function catalog_projection.guard_editor() from public,anon,authenticated;
create trigger guard_editor before insert or update on catalog_projection.documents for each row execute function catalog_projection.guard_editor();

create function catalog_projection.project_source() returns trigger language plpgsql security definer set search_path='' as $$
declare previous jsonb; next_document jsonb; metadata jsonb;
begin
 select document into previous from catalog_projection.documents where id=new.id for update;
 metadata=new.document->'externalProduct';
 if previous is not null and previous->'externalProduct'->>'fingerprint'=metadata->>'fingerprint' and previous->'externalProduct'->>'source_status'=metadata->>'source_status' then
 metadata=metadata||jsonb_build_object('editorial_status',previous->'externalProduct'->'editorial_status','content_rights_status',previous->'externalProduct'->'content_rights_status','rights_evidence',previous->'externalProduct'->'rights_evidence');
 end if;
 next_document=case when previous is null then new.document else previous || jsonb_build_object('externalProduct',metadata,'status','draft','verifiedAt',null) end;
 -- One source revision invalidates outstanding editor saves; no importer can publish.
 next_document=next_document || jsonb_build_object('status','draft','verifiedAt',null,'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 insert into catalog_projection.documents(id,source_id,source_revision,document,missing) values(new.id,new.id,new.revision,next_document,catalog_projection.missing_fields(next_document))
 on conflict(id) do update set document=excluded.document,missing=excluded.missing,source_revision=excluded.source_revision,revision=catalog_projection.documents.revision+1;
 return new;
end $$;
revoke all on function catalog_projection.project_source() from public,anon,authenticated;
create trigger project_source after insert or update on catalog_ingest.products for each row execute function catalog_projection.project_source();
create function catalog_projection.review(product uuid,expected_stamp text,editorial text,rights text,evidence text,actor text) returns void language plpgsql security definer set search_path='' as $$
declare d jsonb; readiness text='blocked';
begin
 if editorial not in ('pending','approved','rejected') or editorial is null or rights not in ('unknown','licensed','restricted') or rights is null then raise exception 'Invalid review';end if;
 if evidence is not null and evidence !~ '^https://' then raise exception 'HTTPS evidence required';end if;
 if rights='licensed' and evidence is null then raise exception 'Rights evidence required';end if;
 select document into d from catalog_projection.documents where id=product for update;
 if d is null or d->'externalProduct'='null' or d->>'updatedAt' is distinct from expected_stamp then raise exception 'Review version conflict';end if;
 if editorial='approved' and rights='licensed' and d->'externalProduct'->>'source_status'='active' and jsonb_array_length(catalog_projection.missing_fields(d))=0 then readiness='ready';end if;
 d=jsonb_set(d,'{externalProduct}',(d->'externalProduct')||jsonb_build_object('editorial_status',editorial,'content_rights_status',rights,'rights_evidence',evidence,'publication_readiness',readiness));
 d=d||jsonb_build_object('status','draft','updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 if readiness='blocked' then d=jsonb_set(d,'{verifiedAt}','null');end if;
 update catalog_projection.documents set document=d,missing=catalog_projection.missing_fields(d),revision=revision+1 where id=product;
 insert into catalog_projection.audit(product_id,actor,event) values(product,actor,'review');
end $$;
revoke all on function catalog_projection.review(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function catalog_projection.review(uuid,text,text,text,text,text) to asia_catalog_editor;
-- Existing source inventory is NOT backfilled automatically. Use bounded explicit projection.
commit;
