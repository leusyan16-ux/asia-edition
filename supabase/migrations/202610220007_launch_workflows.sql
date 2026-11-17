begin;
grant select,insert,update on public.operators to asia_catalog_editor;
create policy projection_editor_operators on public.operators to asia_catalog_editor using(true) with check(true);
create table catalog_projection.inquiries (
 id uuid primary key, product_id uuid not null references catalog_projection.documents(id),
 name text not null check(length(name) between 1 and 120), email text not null check(length(email) between 3 and 254),
 message text not null check(length(message)<=2000), locale text not null check(locale in ('ru','en')),
 consent_version text not null default 'contact-request-2026-10-22',
 contact_hash text not null, request_hash text not null unique,
 status text not null default 'new' check(status in ('new','contacted','closed')),
 created_at timestamptz not null default now()
);
create index inquiry_recent on catalog_projection.inquiries(created_at desc);
create index inquiry_contact on catalog_projection.inquiries(contact_hash,created_at);
alter table catalog_projection.inquiries enable row level security;
revoke all on catalog_projection.inquiries from public,anon,authenticated,asia_catalog_reader,asia_catalog_worker;
grant select,insert,update on catalog_projection.inquiries to asia_catalog_editor;
create policy editor_inquiries on catalog_projection.inquiries to asia_catalog_editor using(true) with check(true);
-- Explicit transactional action, separate from imports and review. Optimistic version guard.
create function catalog_projection.authorize_publication(product uuid, expected_stamp text, actor text) returns void
language plpgsql security definer set search_path='' as $$
declare d catalog_projection.documents; next_doc jsonb;
begin
 if actor is null or length(trim(actor))<1 or length(actor)>254 then raise exception 'Invalid actor';end if;
 select * into d from catalog_projection.documents where id=product for update;
 if not found or d.document->>'updatedAt' is distinct from expected_stamp then raise exception 'Версия изменилась: обновите страницу';end if;
 if coalesce((d.document->>'archived')::boolean,true) or (d.document->>'isDemo')::boolean then raise exception 'Публикация этой записи запрещена';end if;
 if jsonb_array_length(catalog_projection.missing_fields(d.document))>0 then raise exception 'Заполните обязательные данные и подтвердите оператора';end if;
 if not exists(select 1 from public.operators o where o.id::text=d.document->'operator'->>'id' and o.verified_at is not null) then raise exception 'Оператор не проверен';end if;
 insert into catalog_projection.publication_permissions(product_id,approved_revision,source_revision,actor)
 values(d.id,d.revision,coalesce(d.source_revision,0),actor)
 on conflict(product_id) do update set approved_revision=excluded.approved_revision,source_revision=excluded.source_revision,actor=excluded.actor,approved_at=now();
 next_doc=d.document||jsonb_build_object('status','published','visible',true,'updatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 update catalog_projection.documents set document=next_doc,revision=revision+1 where id=d.id;
 insert into catalog_projection.audit(product_id,actor,event) values(d.id,actor,'publication_explicitly_authorized');
end $$;
revoke all on function catalog_projection.authorize_publication(uuid,text,text) from public,anon,authenticated,asia_catalog_reader,asia_catalog_worker;
grant execute on function catalog_projection.authorize_publication(uuid,text,text) to asia_catalog_editor;
commit;
