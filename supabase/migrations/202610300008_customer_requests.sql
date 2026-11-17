-- Customer request MVP. Local preparation only; never modifies existing inventory.
begin;
create table public.commerce_settings(id integer primary key check(id=1), requests_enabled boolean not null default false);
insert into public.commerce_settings values(1,false);
create table public.commerce_profiles (
 user_id uuid primary key references auth.users(id), display_name text not null default '' check(length(display_name)<=120),
 phone text not null default '' check(length(phone)<=40), locale text not null default 'ru' check(locale in('ru','en')), updated_at timestamptz not null default now()
);
create table public.commerce_staff (
 user_id uuid primary key references auth.users(id), role text not null check(role in('owner','admin','manager','editor','support')), active boolean not null default true
);
create table public.commerce_invitations (
 id uuid primary key default gen_random_uuid(), email text not null, role text not null check(role in('admin','manager','editor','support')),
 token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz, accepted_by uuid references auth.users(id), created_by uuid not null references auth.users(id)
);
-- Explicitly provisioned public information snapshot, not imported draft inventory.
create table public.commerce_products (
 slug text primary key, provider text not null, external_id text not null, title jsonb not null, destination jsonb not null,
 requestable boolean not null default false, source_digest text not null, unique(provider,external_id)
);
create table public.commerce_orders (
 id uuid primary key default gen_random_uuid(), number text not null unique default ('AE-'||replace(gen_random_uuid()::text,'-','')),
 customer_id uuid not null references auth.users(id), contact_email text not null check(length(contact_email) between 3 and 254), idempotency_key uuid not null, request_digest text not null,
 status text not null default 'requested' check(status in('draft','requested','awaiting_availability','awaiting_payment','awaiting_supplier_confirmation','confirmed','cancelled','rejected','completed')),
 payment_status text not null default 'unpaid' check(payment_status in('unpaid','pending','paid','partially_refunded','refunded','failed')),
 locale text not null check(locale in('ru','en')), assigned_to uuid references auth.users(id), created_at timestamptz not null default now(), unique(customer_id,idempotency_key)
);
create index commerce_orders_customer on public.commerce_orders(customer_id,created_at desc);
create index commerce_orders_queue on public.commerce_orders(status,created_at);
create table public.commerce_order_items (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.commerce_orders(id), product_slug text not null references public.commerce_products(slug),
 title jsonb not null, destination jsonb not null, requested_date date not null, adults integer not null check(adults between 1 and 20), children integer not null check(children between 0 and 20),
 options text not null default '' check(length(options)<=1000), amount numeric(20,2) check(amount>=0), currency text check(currency ~ '^[A-Z]{3}$'), check((amount is null)=(currency is null))
);
create index commerce_items_order on public.commerce_order_items(order_id);
create table public.commerce_bookings (
 id uuid primary key default gen_random_uuid(), item_id uuid not null unique references public.commerce_order_items(id),
 status text not null default 'requested' check(status in('requested','awaiting_availability','awaiting_payment','awaiting_supplier_confirmation','confirmed','cancelled','rejected','completed')),
 supplier_code text, confirmation_basis text, confirmed_at timestamptz, revision integer not null default 1,
 check(status<>'confirmed' or (length(confirmation_basis)>=10 and confirmed_at is not null))
);
create table public.commerce_booking_events (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.commerce_bookings(id), actor uuid not null references auth.users(id),
 old_status text, new_status text not null, reason text not null check(length(reason) between 5 and 2000), created_at timestamptz not null default now()
);
create table public.commerce_travelers (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.commerce_order_items(id), name text not null check(length(name) between 1 and 120)
);
create table public.commerce_payment_attempts (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.commerce_orders(id), provider text not null, external_id text unique,
 amount numeric(20,2) not null check(amount>0), currency text not null check(currency ~ '^[A-Z]{3}$'), status text not null, created_at timestamptz not null default now()
);
create table public.commerce_documents (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.commerce_orders(id), kind text not null check(kind in('request_receipt','voucher')),
 version integer not null check(version>0), payload jsonb not null, created_at timestamptz not null default now(), unique(order_id,kind,version)
);
create table public.commerce_favorites (user_id uuid not null references auth.users(id), product_slug text not null references public.commerce_products(slug), primary key(user_id,product_slug));
create table public.commerce_carts (user_id uuid primary key references auth.users(id), items jsonb not null default '[]' check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=20), revision integer not null default 1);
create table public.commerce_privacy_requests (user_id uuid primary key references auth.users(id), requested_at timestamptz not null default now(), status text not null default 'pending' check(status in('pending','processing','completed')));
create table public.commerce_order_notes(id uuid primary key default gen_random_uuid(), order_id uuid not null references public.commerce_orders(id), actor uuid not null references auth.users(id), note text not null check(length(note) between 1 and 2000),created_at timestamptz not null default now());
create index commerce_events_booking on public.commerce_booking_events(booking_id,created_at);
create index commerce_travelers_item on public.commerce_travelers(item_id);
create index commerce_payments_order on public.commerce_payment_attempts(order_id);
create index commerce_notes_order on public.commerce_order_notes(order_id,created_at);
create table public.commerce_audit (id uuid primary key default gen_random_uuid(), actor uuid references auth.users(id), action text not null, resource uuid, old_value jsonb, new_value jsonb, created_at timestamptz not null default now());

create function public.commerce_staff_role() returns text language sql stable security definer set search_path=pg_catalog,public,auth as $$
 select role from public.commerce_staff where user_id=auth.uid() and active and auth.jwt()->>'aal'='aal2'
$$;
create function public.commerce_can_read_order(oid uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public,auth as $$
 select exists(select 1 from public.commerce_orders where id=oid and (customer_id=auth.uid() or public.commerce_staff_role() in('owner','admin','manager','support')))
$$;

do $$ declare t text; begin
 foreach t in array array['settings','profiles','staff','invitations','products','orders','order_items','bookings','booking_events','travelers','payment_attempts','documents','favorites','carts','privacy_requests','order_notes','audit'] loop
 execute format('alter table public.%I enable row level security','commerce_'||t);
 execute format('revoke all on public.%I from public,anon,authenticated','commerce_'||t);
 end loop;
end $$;
grant select on public.commerce_products to authenticated;
create policy commerce_product_read on public.commerce_products for select to authenticated using(requestable);
grant select,insert,update on public.commerce_profiles to authenticated;
create policy commerce_profile_own on public.commerce_profiles to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select on public.commerce_staff to authenticated;
create policy commerce_staff_self on public.commerce_staff for select to authenticated using(user_id=auth.uid());
grant select on public.commerce_orders,public.commerce_order_items,public.commerce_bookings,public.commerce_booking_events,public.commerce_travelers,public.commerce_payment_attempts,public.commerce_documents to authenticated;
create policy commerce_orders_read on public.commerce_orders for select to authenticated using(public.commerce_can_read_order(id));
create policy commerce_items_read on public.commerce_order_items for select to authenticated using(public.commerce_can_read_order(order_id));
create policy commerce_bookings_read on public.commerce_bookings for select to authenticated using(exists(select 1 from public.commerce_order_items i where i.id=item_id and public.commerce_can_read_order(i.order_id)));
create policy commerce_events_read on public.commerce_booking_events for select to authenticated using(exists(select 1 from public.commerce_bookings b join public.commerce_order_items i on i.id=b.item_id where b.id=booking_id and public.commerce_can_read_order(i.order_id)));
create policy commerce_travelers_read on public.commerce_travelers for select to authenticated using(exists(select 1 from public.commerce_order_items i where i.id=item_id and public.commerce_can_read_order(i.order_id)));
create policy commerce_payments_read on public.commerce_payment_attempts for select to authenticated using(public.commerce_can_read_order(order_id));
create policy commerce_documents_read on public.commerce_documents for select to authenticated using(public.commerce_can_read_order(order_id));
grant select,insert,update,delete on public.commerce_favorites to authenticated;
create policy commerce_favorites_own on public.commerce_favorites to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,insert,update on public.commerce_carts to authenticated;
create policy commerce_carts_own on public.commerce_carts to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select on public.commerce_privacy_requests to authenticated;
create policy commerce_privacy_own on public.commerce_privacy_requests for select to authenticated using(user_id=auth.uid());
grant select on public.commerce_audit to authenticated;
create policy commerce_audit_owner on public.commerce_audit for select to authenticated using(public.commerce_staff_role() in('owner','admin'));

create function public.commerce_request(key uuid, lang text, lines jsonb) returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare uid uuid:=auth.uid(); oid uuid; digest text:=encode(sha256(convert_to(lines::text||lang,'UTF8')),'hex'); old_digest text; l jsonb; p public.commerce_products; iid uuid; bid uuid;
begin
 if not exists(select 1 from public.commerce_settings where id=1 and requests_enabled) then raise exception 'Requests disabled'; end if;
 if uid is null or lang not in('ru','en') or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 20 then raise exception 'Invalid request'; end if;
 if not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null) then raise exception 'Email confirmation required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id,request_digest into oid,old_digest from public.commerce_orders where customer_id=uid and idempotency_key=key;
 if oid is not null then if digest<>old_digest then raise exception 'Idempotency conflict'; end if; return oid; end if;
 if (select count(*) from public.commerce_orders where customer_id=uid and created_at>now()-interval '1 hour')>=5 then raise exception 'Request limit'; end if;
 insert into public.commerce_orders(customer_id,contact_email,idempotency_key,request_digest,locale) values(uid,(select email from auth.users where id=uid),key,digest,lang) returning id into oid;
 for l in select value from jsonb_array_elements(lines) loop
  select * into p from public.commerce_products where slug=l->>'slug' and requestable for share;
  if not found or (l->>'date')::date<current_date or (l->>'date')::date>current_date+730 or l->>'date' is null or l->>'adults' is null or l->>'children' is null then raise exception 'Product or date unavailable'; end if;
  insert into public.commerce_order_items(order_id,product_slug,title,destination,requested_date,adults,children,options)
   values(oid,p.slug,p.title,p.destination,(l->>'date')::date,(l->>'adults')::integer,(l->>'children')::integer,coalesce(l->>'options','')) returning id into iid;
  insert into public.commerce_bookings(item_id) values(iid) returning id into bid;
  insert into public.commerce_booking_events(booking_id,actor,new_status,reason) values(bid,uid,'requested','Customer request received, not a reservation');
 end loop;
 insert into public.commerce_documents(order_id,kind,version,payload) values(oid,'request_receipt',1,jsonb_build_object('order',(select to_jsonb(o) from public.commerce_orders o where id=oid),'items',(select jsonb_agg(to_jsonb(i)) from public.commerce_order_items i where order_id=oid)));
 return oid;
end $$;

create function public.commerce_transition(bid uuid, expected_revision integer, target text, basis text, supplier text default null) returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare b public.commerce_bookings; oid uuid; customer uuid; staff text:=public.commerce_staff_role(); allowed boolean:=false;
begin
 select * into b from public.commerce_bookings where id=bid for update;
 if not found or b.revision<>expected_revision then raise exception 'Stale or missing booking'; end if;
 select o.id,o.customer_id into oid,customer from public.commerce_order_items i join public.commerce_orders o on o.id=i.order_id where i.id=b.item_id;
 perform 1 from public.commerce_orders where id=oid for update;
 if staff in('owner','admin','manager') then
 allowed:=case b.status when 'requested' then target in('awaiting_availability','rejected','cancelled') when 'awaiting_availability' then target in('awaiting_supplier_confirmation','rejected','cancelled') when 'awaiting_supplier_confirmation' then target in('confirmed','rejected','cancelled') when 'confirmed' then target in('completed','cancelled') else false end;
 elsif customer=auth.uid() then allowed:=target='cancelled' and b.status in('requested','awaiting_availability'); end if;
 if not coalesce(allowed,false) or length(coalesce(basis,'')) not between 10 and 2000 then raise exception 'Transition denied'; end if;
 update public.commerce_bookings set status=target,revision=revision+1,confirmation_basis=case when target='confirmed' then basis else confirmation_basis end,supplier_code=case when target='confirmed' then nullif(supplier,'') else supplier_code end,confirmed_at=case when target='confirmed' then now() else confirmed_at end where id=bid;
 insert into public.commerce_booking_events(booking_id,actor,old_status,new_status,reason) values(bid,auth.uid(),b.status,target,basis);
 insert into public.commerce_audit(actor,action,resource,old_value,new_value) values(auth.uid(),'booking_transition',bid,to_jsonb(b),jsonb_build_object('status',target,'basis',basis));
 -- A mixed order remains requested: never infer full confirmation from one item.
 if not exists(select 1 from public.commerce_bookings x join public.commerce_order_items i on i.id=x.item_id where i.order_id=oid and x.status<>target) then update public.commerce_orders set status=target where id=oid; end if;
 if target='confirmed' then
 insert into public.commerce_documents(order_id,kind,version,payload)
 select oid,'voucher',coalesce((select max(version)+1 from public.commerce_documents where order_id=oid and kind='voucher'),1),jsonb_build_object('booking_id',bid,'title',(select title from public.commerce_order_items where id=b.item_id),'status',target,'supplier_code',supplier,'confirmed_at',now(),'order',(select to_jsonb(o) from public.commerce_orders o where id=oid),'items',(select jsonb_agg(to_jsonb(i)) from public.commerce_order_items i where id=b.item_id));
 end if;
end $$;

create function public.commerce_staff_set(subject uuid, new_role text, enabled boolean) returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
 if public.commerce_staff_role() is distinct from 'owner' or subject=auth.uid() then raise exception 'Owner approval required; self change denied'; end if;
 insert into public.commerce_audit(actor,action,resource,old_value,new_value) values(auth.uid(),'staff_change',subject,(select to_jsonb(s) from public.commerce_staff s where user_id=subject),jsonb_build_object('role',new_role,'active',enabled));
 insert into public.commerce_staff(user_id,role,active) values(subject,new_role,enabled) on conflict(user_id) do update set role=excluded.role,active=excluded.active;
end $$;
create function public.commerce_privacy_request() returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into public.commerce_privacy_requests(user_id) values(auth.uid()) on conflict do nothing;
 update public.commerce_profiles set display_name='',phone='',updated_at=now() where user_id=auth.uid();
 delete from public.commerce_favorites where user_id=auth.uid();
 delete from public.commerce_carts where user_id=auth.uid();
end $$;

create function public.commerce_invite(mail text, invited_role text, secret_hash text) returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare invite_id uuid;
begin
 if public.commerce_staff_role() is distinct from 'owner' or invited_role not in('admin','manager','editor','support') or length(secret_hash)<>64 or length(mail) not between 3 and 254 then raise exception 'Invitation denied'; end if;
 insert into public.commerce_invitations(email,role,token_hash,expires_at,created_by) values(lower(mail),invited_role,secret_hash,now()+interval '48 hours',auth.uid()) returning id into invite_id;
 insert into public.commerce_audit(actor,action,resource,new_value) values(auth.uid(),'staff_invited',invite_id,jsonb_build_object('role',invited_role));return invite_id;
end $$;
create function public.commerce_accept_invite(secret_hash text) returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare invitation public.commerce_invitations; email text;
begin
 select u.email into email from auth.users u where id=auth.uid() and email_confirmed_at is not null;
 select * into invitation from public.commerce_invitations where token_hash=secret_hash and revoked_at is null and accepted_by is null and expires_at>now() for update;
 if not found or email is null or lower(email)<>invitation.email or exists(select 1 from public.commerce_staff where user_id=auth.uid()) then raise exception 'Invalid invitation'; end if;
 insert into public.commerce_staff(user_id,role) values(auth.uid(),invitation.role);
 update public.commerce_invitations set accepted_by=auth.uid() where id=invitation.id;
 insert into public.commerce_audit(actor,action,resource) values(auth.uid(),'staff_invite_accepted',invitation.id);
end $$;
create function public.commerce_revoke_invite(invite_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
 if public.commerce_staff_role() is distinct from 'owner' then raise exception 'Owner required'; end if;
 update public.commerce_invitations set revoked_at=now() where id=invite_id and accepted_by is null;
 insert into public.commerce_audit(actor,action,resource) values(auth.uid(),'staff_invite_revoked',invite_id);
end $$;
revoke all on function public.commerce_invite(text,text,text),public.commerce_accept_invite(text),public.commerce_revoke_invite(uuid) from public,anon;
grant execute on function public.commerce_invite(text,text,text),public.commerce_accept_invite(text),public.commerce_revoke_invite(uuid) to authenticated;

grant select on public.commerce_invitations,public.commerce_order_notes to authenticated;
create policy commerce_invitations_owner on public.commerce_invitations for select to authenticated using(public.commerce_staff_role()='owner');
create policy commerce_staff_owner_read on public.commerce_staff for select to authenticated using(public.commerce_staff_role()='owner');
create policy commerce_notes_staff on public.commerce_order_notes for select to authenticated using(public.commerce_staff_role() in('owner','admin','manager','support') and public.commerce_can_read_order(order_id));
create policy commerce_profiles_staff on public.commerce_profiles for select to authenticated using(public.commerce_staff_role() in('owner','admin','manager'));
create function public.commerce_manage_order(oid uuid, manager uuid, memo text) returns void language plpgsql security definer set search_path=pg_catalog,public,auth as $$
begin
 if public.commerce_staff_role() not in('owner','admin','manager') or public.commerce_staff_role() is null or not public.commerce_can_read_order(oid) then raise exception 'Management denied'; end if;
 if manager is not null and not exists(select 1 from public.commerce_staff where user_id=manager and active and role in('owner','admin','manager')) then raise exception 'Invalid assignee'; end if;
 if length(coalesce(memo,''))>2000 then raise exception 'Note too long'; end if;
 perform 1 from public.commerce_orders where id=oid for update;
 insert into public.commerce_audit(actor,action,resource,old_value,new_value) select auth.uid(),'order_assignment',oid,jsonb_build_object('assigned_to',assigned_to),jsonb_build_object('assigned_to',manager) from public.commerce_orders where id=oid;
 update public.commerce_orders set assigned_to=manager where id=oid;
 if length(coalesce(memo,''))>0 then insert into public.commerce_order_notes(order_id,actor,note) values(oid,auth.uid(),memo); end if;
end $$;
revoke all on function public.commerce_manage_order(uuid,uuid,text) from public,anon;
grant execute on function public.commerce_manage_order(uuid,uuid,text) to authenticated;

create function public.commerce_regenerate_receipt(oid uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v integer; did uuid;
begin
 if not public.commerce_can_read_order(oid) or auth.uid() is null then raise exception 'Access denied'; end if;
 perform 1 from public.commerce_orders where id=oid for update;
 select coalesce(max(version),0)+1 into v from public.commerce_documents where order_id=oid and kind='request_receipt';
 if v>20 then raise exception 'Regeneration limit'; end if;
 insert into public.commerce_documents(order_id,kind,version,payload) values(oid,'request_receipt',v,jsonb_build_object('order',(select to_jsonb(o) from public.commerce_orders o where id=oid),'items',(select jsonb_agg(to_jsonb(i)) from public.commerce_order_items i where order_id=oid))) returning id into did;
 return did;
end $$;
create function public.commerce_export_personal() returns jsonb language sql stable security definer set search_path=pg_catalog,public,auth as $$
 select jsonb_build_object(
 'profile',(select to_jsonb(p) from public.commerce_profiles p where user_id=auth.uid()),
 'orders',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from public.commerce_orders o where customer_id=auth.uid()),
 'items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from public.commerce_order_items i join public.commerce_orders o on o.id=i.order_id where o.customer_id=auth.uid()),
 'bookings',(select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from public.commerce_bookings b join public.commerce_order_items i on i.id=b.item_id join public.commerce_orders o on o.id=i.order_id where o.customer_id=auth.uid()),
 'travelers',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.commerce_travelers t join public.commerce_order_items i on i.id=t.item_id join public.commerce_orders o on o.id=i.order_id where o.customer_id=auth.uid()),
 'payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from public.commerce_payment_attempts p join public.commerce_orders o on o.id=p.order_id where o.customer_id=auth.uid()),
 'documents',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from public.commerce_documents d join public.commerce_orders o on o.id=d.order_id where o.customer_id=auth.uid()),
 'favorites',(select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) from public.commerce_favorites f where user_id=auth.uid()),
 'cart',(select to_jsonb(c) from public.commerce_carts c where user_id=auth.uid())
 )
$$;
revoke all on function public.commerce_regenerate_receipt(uuid),public.commerce_export_personal() from public,anon;
grant execute on function public.commerce_regenerate_receipt(uuid),public.commerce_export_personal() to authenticated;
revoke all on function public.commerce_staff_role(),public.commerce_can_read_order(uuid),public.commerce_request(uuid,text,jsonb),public.commerce_transition(uuid,integer,text,text,text),public.commerce_staff_set(uuid,text,boolean),public.commerce_privacy_request() from public,anon;
grant execute on function public.commerce_staff_role(),public.commerce_can_read_order(uuid),public.commerce_request(uuid,text,jsonb),public.commerce_transition(uuid,integer,text,text,text),public.commerce_staff_set(uuid,text,boolean),public.commerce_privacy_request() to authenticated;
commit;
