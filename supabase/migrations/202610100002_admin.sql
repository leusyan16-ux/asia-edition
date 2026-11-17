begin;
-- Provision membership with trusted SQL only. User metadata never grants privileges.
create table public.admin_members(user_id uuid primary key references auth.users(id) on delete cascade,role text not null check(role in ('admin','viewer')));
alter table public.admin_members enable row level security;
revoke all on public.admin_members from public,anon,authenticated;
grant select on public.admin_members to authenticated;
create policy own_membership on public.admin_members for select to authenticated using(user_id=auth.uid());
create function public.is_inventory_admin() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.admin_members where user_id=auth.uid() and role='admin') $$;
revoke all on function public.is_inventory_admin() from public,anon,authenticated;
grant execute on function public.is_inventory_admin() to authenticated;
alter table public.tours add column archived boolean not null default false,add column visible boolean not null default true,add column city_id uuid,add column resort_id uuid;
alter table public.tours add foreign key(city_id,country_slug) references public.locations(id,country_slug),add foreign key(resort_id,country_slug) references public.locations(id,country_slug);
alter table public.tours add constraint archive_not_published check(not archived or status<>'published');
create table public.admin_tour_documents(tour_id uuid primary key references public.tours(id) on delete cascade,document jsonb not null);
create table public.admin_audit_events(id uuid primary key default gen_random_uuid(),actor_id uuid not null references auth.users(id),tour_id uuid not null references public.tours(id),action text not null,old_status text,new_status text,created_at timestamptz not null default now());
alter table public.admin_audit_events enable row level security;
revoke all on public.admin_audit_events from public,anon,authenticated;
grant select on public.admin_audit_events to authenticated;
create policy audit_read on public.admin_audit_events for select to authenticated using(public.is_inventory_admin());
alter table public.admin_tour_documents enable row level security;
revoke all on public.admin_tour_documents from public,anon,authenticated;
grant select on public.admin_tour_documents to authenticated;
create policy admin_document_read on public.admin_tour_documents for select to authenticated using(public.is_inventory_admin());
do $$ declare t text;begin foreach t in array array['operators','supplier_details','tours','tour_translations','tour_images','tour_itinerary','tour_faq','tour_pickup_locations','tour_meeting_points','tour_prices','tour_schedules','tour_availability'] loop
 execute format('create policy admin_read on public.%I for select to authenticated using(public.is_inventory_admin())',t);
end loop;end $$;
drop policy published_tours on public.tours;
create policy published_tours on public.tours for select to anon,authenticated using(status='published' and visible and not archived and verified_at is not null and not is_demo and exists(select 1 from public.operators where id=operator_id and verified_at is not null));
-- Preserve read RLS; no direct table write grants. Only authorized transactional RPCs write.
create function public.admin_tour_payload(t public.tours) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
 'id',t.id,'slug',t.slug,'country',t.country_slug,'location',l.slug,'category',t.category_slug,'status',t.status,'isDemo',t.is_demo,'verifiedAt',t.verified_at,'featured',t.featured,
 'title',jsonb_build_object('ru',coalesce(r.title,''),'en',coalesce(e.title,'')),'summary',jsonb_build_object('ru',coalesce(r.summary,''),'en',coalesce(e.summary,'')),
 'description',jsonb_build_object('ru',coalesce(r.description,array[]::text[]),'en',coalesce(e.description,array[]::text[])),'highlights',jsonb_build_object('ru',coalesce(r.highlights,array[]::text[]),'en',coalesce(e.highlights,array[]::text[])),
 'images',coalesce((select jsonb_agg(jsonb_build_object('url',url,'alt',jsonb_build_object('ru',alt_ru,'en',alt_en)) order by position) from public.tour_images where tour_id=t.id),'[]'),
 'durationMinutes',t.duration_minutes,'transportation',case when coalesce(r.transportation,e.transportation) is null then null else jsonb_build_object('ru',coalesce(r.transportation,''),'en',coalesce(e.transportation,'')) end,
 'languages',t.languages,'schedule',case when coalesce(r.schedule,e.schedule) is null then null else jsonb_build_object('ru',coalesce(r.schedule,''),'en',coalesce(e.schedule,'')) end,'timezone',t.timezone,
 'departures',coalesce((select jsonb_agg(jsonb_build_object('weekdays',weekdays,'time',departure_time,'validFrom',valid_from,'validUntil',valid_until) order by departure_time) from public.tour_schedules where tour_id=t.id),'[]'),
 'pickupLocations',coalesce((select jsonb_agg(jsonb_build_object('name',jsonb_build_object('ru',p.name_ru,'en',p.name_en),'address',jsonb_build_object('ru',p.address_ru,'en',p.address_en),'location',loc.slug,'instructions',case when coalesce(p.instructions_ru,p.instructions_en) is null then null else jsonb_build_object('ru',coalesce(p.instructions_ru,''),'en',coalesce(p.instructions_en,'')) end) order by p.position) from public.tour_pickup_locations p join public.locations loc on loc.id=p.location_id where p.tour_id=t.id),'[]'),
 'meetingPoints',coalesce((select jsonb_agg(jsonb_build_object('name',jsonb_build_object('ru',name_ru,'en',name_en),'address',jsonb_build_object('ru',address_ru,'en',address_en),'lat',latitude,'lng',longitude) order by position) from public.tour_meeting_points where tour_id=t.id),'[]'),
 'itinerary',coalesce((select jsonb_agg(jsonb_build_object('title',jsonb_build_object('ru',title_ru,'en',title_en),'description',jsonb_build_object('ru',description_ru,'en',description_en),'durationMinutes',duration_minutes) order by position) from public.tour_itinerary where tour_id=t.id),'[]'),
 'inclusions',jsonb_build_object('ru',coalesce(r.inclusions,array[]::text[]),'en',coalesce(e.inclusions,array[]::text[])),'exclusions',jsonb_build_object('ru',coalesce(r.exclusions,array[]::text[]),'en',coalesce(e.exclusions,array[]::text[])),
 'meeting',case when coalesce(r.meeting,e.meeting) is null then null else jsonb_build_object('ru',coalesce(r.meeting,''),'en',coalesce(e.meeting,'')) end,
 'pickup',case when coalesce(r.pickup,e.pickup) is null then null else jsonb_build_object('ru',coalesce(r.pickup,''),'en',coalesce(e.pickup,'')) end,
 'coordinates',case when t.latitude is null then null else jsonb_build_object('lat',t.latitude,'lng',t.longitude) end,
 'prices',coalesce((select jsonb_agg(jsonb_build_object('currency',p.currency,'adult',p.adult,'child',p.child,'childMinAge',p.child_min_age,'childMaxAge',p.child_max_age)) from (select distinct on(currency) * from public.tour_prices where tour_id=t.id order by currency,valid_from desc nulls last,verified_at desc) p),'[]'),
 'availability',coalesce((select jsonb_agg(jsonb_build_object('date',d.service_date,'remaining',d.remaining,'status',d.status) order by d.service_date) from (select service_date,max(case when status='available' then capacity-reserved else 0 end) remaining,case when bool_or(status='available' and capacity>reserved) then 'available' when bool_or(status='sold_out') then 'sold_out' else 'closed' end status from public.tour_availability where tour_id=t.id group by service_date) d),'[]'),
 'cancellation',case when coalesce(r.cancellation,e.cancellation) is null then null else jsonb_build_object('ru',coalesce(r.cancellation,''),'en',coalesce(e.cancellation,'')) end,
 'bookingConditions',case when coalesce(r.booking_conditions,e.booking_conditions) is null then null else jsonb_build_object('ru',coalesce(r.booking_conditions,''),'en',coalesce(e.booking_conditions,'')) end,
 'faq',coalesce((select jsonb_agg(jsonb_build_object('question',jsonb_build_object('ru',question_ru,'en',question_en),'answer',jsonb_build_object('ru',answer_ru,'en',answer_en)) order by position) from public.tour_faq where tour_id=t.id),'[]'),
 'operator',case when o.id is null then null else jsonb_build_object('id',o.id,'name',o.name) end,
 'seo',jsonb_build_object('title',jsonb_build_object('ru',coalesce(r.seo_title,''),'en',coalesce(e.seo_title,'')),'description',jsonb_build_object('ru',coalesce(r.seo_description,''),'en',coalesce(e.seo_description,''))), 'updatedAt',t.updated_at
)
from public.locations l left join public.tour_translations r on r.tour_id=t.id and r.locale='ru' left join public.tour_translations e on e.tour_id=t.id and e.locale='en' left join public.operators o on o.id=t.operator_id where l.id=t.location_id;
$$;
revoke all on function public.admin_tour_payload(public.tours) from public,anon,authenticated;
create function public.admin_inventory(tour_filter uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_inventory_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(coalesce(d.document,public.admin_tour_payload(t)||jsonb_build_object('archived',t.archived,'visible',t.visible,'city',(select slug from public.locations where id=t.city_id),'resort',(select slug from public.locations where id=t.resort_id),
 'prices',coalesce((select jsonb_agg(jsonb_build_object('currency',p.currency,'adult',p.adult,'child',p.child,'childMinAge',p.child_min_age,'childMaxAge',p.child_max_age,'validFrom',p.valid_from,'validUntil',p.valid_until,'verifiedAt',p.verified_at)) from (select distinct on(currency) * from public.tour_prices where tour_id=t.id order by currency,valid_from desc nulls last,verified_at desc) p),'[]'),
 'slots',coalesce((select jsonb_agg(jsonb_build_object('date',service_date,'time',departure_time,'capacity',capacity,'reserved',reserved,'status',status,'verifiedAt',verified_at) order by service_date,departure_time) from public.tour_availability where tour_id=t.id),'[]')))||jsonb_build_object('updatedAt',t.updated_at,'slots',coalesce((select jsonb_agg(jsonb_build_object('date',service_date,'time',departure_time,'capacity',capacity,'reserved',reserved,'status',status,'verifiedAt',verified_at) order by service_date,departure_time) from public.tour_availability where tour_id=t.id),'[]')) order by t.updated_at desc) from public.tours t left join public.admin_tour_documents d on d.tour_id=t.id where tour_filter is null or t.id=tour_filter),'[]');
end $$;
-- Compact summary: list/statistics never transfer hundreds of descriptions and calendars.
create function public.admin_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_inventory_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'country',t.country_slug,'status',t.status,'archived',t.archived,'visible',t.visible,'featured',t.featured,'isDemo',t.is_demo,'title',jsonb_build_object('ru',coalesce(r.title,''),'en',coalesce(e.title,'')),'updatedAt',t.updated_at,
 'missing',array_remove(array[
 case when coalesce(length(trim(r.title)),0)=0 then 'Название RU' end,
 case when coalesce(length(trim(e.title)),0)=0 then 'Название EN' end,
 case when coalesce(length(trim(array_to_string(r.description,' '))),0)=0 then 'Описание RU' end,
 case when coalesce(length(trim(array_to_string(e.description,' '))),0)=0 then 'Описание EN' end,
 case when not exists(select 1 from public.tour_images where tour_id=t.id) then 'Добавьте фотографию' end,
 case when t.duration_minutes is null then 'Укажите длительность' end,
 case when not t.is_demo and (t.operator_id is null or t.verified_at is null) then 'Подтвердите оператора и дату проверки экскурсии' end,
 case when not t.is_demo and t.operator_id is not null and o.verified_at is null then 'Оператор ещё не проверен' end],null)) order by t.updated_at desc)
 from public.tours t left join public.tour_translations r on r.tour_id=t.id and r.locale='ru' left join public.tour_translations e on e.tour_id=t.id and e.locale='en' left join public.operators o on o.id=t.operator_id),'[]');
end $$;
create function public.admin_save_batch(documents jsonb,expected_versions jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare d jsonb;tid uuid;loc uuid;city uuid;resort uuid;prior public.tours;lang text;item jsonb;pos int;stamp timestamptz;result jsonb='[]';pid uuid;source_metadata jsonb;
begin
 if not public.is_inventory_admin() then raise exception 'Administrator required' using errcode='42501';end if;
 if jsonb_typeof(documents) is distinct from 'array' or jsonb_typeof(expected_versions) is distinct from 'object' then raise exception 'Invalid batch';end if;
 if jsonb_array_length(documents) not between 1 and 1000 then raise exception 'Invalid batch';end if;
 -- Prevent simultaneous inserts/imports and lock rows in one transaction.
 perform pg_advisory_xact_lock(72619482);
 for d in select value from jsonb_array_elements(documents) loop
  tid=(d->>'id')::uuid;select * into prior from public.tours where id=tid for update;
  if prior.id is not null and prior.updated_at is distinct from (expected_versions->>tid::text)::timestamptz then raise exception 'version conflict';end if;
  if prior.id is null and coalesce(expected_versions->>tid::text,'')<>'' then raise exception 'version conflict';end if;
  -- An older client must not erase a stored source marker to bypass review.
  select document->'externalProduct' into source_metadata from public.admin_tour_documents where tour_id=tid;
  if source_metadata is not null and source_metadata<>'null'::jsonb then d=jsonb_set(d,'{externalProduct}',source_metadata);end if;
  -- Serialize against reservation writers before comparing their counters.
  perform 1 from public.tour_availability a where a.tour_id=tid order by a.service_date,a.departure_time for update;
  select id into loc from public.locations where slug=d->>'location' and country_slug=d->>'country';if loc is null then raise exception 'Invalid location';end if;
  city=null;resort=null;
  if coalesce(d->>'city','')<>'' then select id into city from public.locations where slug=d->>'city' and country_slug=d->>'country' and kind='city';if city is null then raise exception 'Invalid city';end if;end if;
  if coalesce(d->>'resort','')<>'' then select id into resort from public.locations where slug=d->>'resort' and country_slug=d->>'country' and kind='resort';if resort is null then raise exception 'Invalid resort';end if;end if;
  if coalesce(d->>'archived','false')::boolean and d->>'status'='published' then raise exception 'Archived tour';end if;
  -- Source review/licensing must not be asserted by arbitrary cached JSON in this legacy RPC.
  if d->>'status'='published' and d->'externalProduct' is not null and d->'externalProduct'<>'null'::jsonb then raise exception 'External products require the reviewed publication workflow';end if;
  if (select count(*) from jsonb_array_elements(d->'prices'))<>(select count(distinct value->>'currency') from jsonb_array_elements(d->'prices')) then raise exception 'Duplicate currency';end if;
  if exists(select 1 from jsonb_array_elements(d->'slots') s group by (s->>'date')::date,(s->>'time')::time having count(*)>1) then raise exception 'Duplicate slot';end if;
  if prior.id is not null then update public.tours set status='draft' where id=tid;end if;
  delete from public.tour_pickup_locations where tour_id=tid;
  insert into public.tours(id,slug,country_slug,location_id,category_slug,operator_id,status,is_demo,verified_at,featured,duration_minutes,timezone,languages,latitude,longitude,archived,visible,city_id,resort_id)
  values(tid,d->>'slug',d->>'country',loc,d->>'category',(d->'operator'->>'id')::uuid,'draft',(d->>'isDemo')::boolean,(d->>'verifiedAt')::timestamptz,(d->>'featured')::boolean,(d->>'durationMinutes')::int,d->>'timezone',array(select jsonb_array_elements_text(d->'languages')),(d->'coordinates'->>'lat')::numeric,(d->'coordinates'->>'lng')::numeric,coalesce((d->>'archived')::boolean,false),coalesce((d->>'visible')::boolean,true),city,resort)
  on conflict(id) do update set slug=excluded.slug,country_slug=excluded.country_slug,location_id=excluded.location_id,category_slug=excluded.category_slug,operator_id=excluded.operator_id,status='draft',is_demo=excluded.is_demo,verified_at=excluded.verified_at,featured=excluded.featured,duration_minutes=excluded.duration_minutes,timezone=excluded.timezone,languages=excluded.languages,latitude=excluded.latitude,longitude=excluded.longitude,archived=excluded.archived,visible=excluded.visible,city_id=excluded.city_id,resort_id=excluded.resort_id;
  delete from public.tour_translations where tour_id=tid;
  foreach lang in array array['ru','en'] loop
   insert into public.tour_translations(tour_id,locale,title,summary,description,highlights,transportation,schedule,inclusions,exclusions,meeting,pickup,cancellation,booking_conditions,seo_title,seo_description)
   values(tid,lang,d->'title'->>lang,coalesce(d->'summary'->>lang,''),array(select jsonb_array_elements_text(d->'description'->lang)),array(select jsonb_array_elements_text(d->'highlights'->lang)),d->'transportation'->>lang,d->'schedule'->>lang,array(select jsonb_array_elements_text(d->'inclusions'->lang)),array(select jsonb_array_elements_text(d->'exclusions'->lang)),d->'meeting'->>lang,d->'pickup'->>lang,d->'cancellation'->>lang,d->'bookingConditions'->>lang,coalesce(d->'seo'->'title'->>lang,''),coalesce(d->'seo'->'description'->>lang,''));
  end loop;
  delete from public.tour_images where tour_id=tid;pos=0;
  for item in select value from jsonb_array_elements(d->'images') loop insert into public.tour_images(tour_id,url,alt_ru,alt_en,position) values(tid,item->>'url',coalesce(item->'alt'->>'ru',''),coalesce(item->'alt'->>'en',''),pos);pos=pos+1;end loop;
  delete from public.tour_itinerary where tour_id=tid;pos=0;
  for item in select value from jsonb_array_elements(d->'itinerary') loop insert into public.tour_itinerary(tour_id,position,title_ru,title_en,description_ru,description_en,duration_minutes) values(tid,pos,item->'title'->>'ru',item->'title'->>'en',item->'description'->>'ru',item->'description'->>'en',(item->>'durationMinutes')::int);pos=pos+1;end loop;
  delete from public.tour_faq where tour_id=tid;pos=0;
  for item in select value from jsonb_array_elements(d->'faq') loop insert into public.tour_faq(tour_id,position,question_ru,question_en,answer_ru,answer_en) values(tid,pos,item->'question'->>'ru',item->'question'->>'en',item->'answer'->>'ru',item->'answer'->>'en');pos=pos+1;end loop;
  delete from public.tour_pickup_locations where tour_id=tid;pos=0;
  for item in select value from jsonb_array_elements(d->'pickupLocations') loop
   select id into pid from public.locations where country_slug=d->>'country' and slug=item->>'location';if pid is null then raise exception 'Invalid pickup';end if;
   insert into public.tour_pickup_locations(tour_id,country_slug,location_id,name_ru,name_en,address_ru,address_en,instructions_ru,instructions_en,position) values(tid,d->>'country',pid,item->'name'->>'ru',item->'name'->>'en',item->'address'->>'ru',item->'address'->>'en',item->'instructions'->>'ru',item->'instructions'->>'en',pos);pos=pos+1;
  end loop;
  delete from public.tour_meeting_points where tour_id=tid;pos=0;
  for item in select value from jsonb_array_elements(d->'meetingPoints') loop insert into public.tour_meeting_points(tour_id,name_ru,name_en,address_ru,address_en,latitude,longitude,position) values(tid,item->'name'->>'ru',item->'name'->>'en',item->'address'->>'ru',item->'address'->>'en',(item->>'lat')::numeric,(item->>'lng')::numeric,pos);pos=pos+1;end loop;
  delete from public.tour_prices where tour_id=tid;
  for item in select value from jsonb_array_elements(d->'prices') loop insert into public.tour_prices(tour_id,currency,adult,child,child_min_age,child_max_age,valid_from,valid_until,verified_at) values(tid,item->>'currency',(item->>'adult')::numeric,(item->>'child')::numeric,(item->>'childMinAge')::int,(item->>'childMaxAge')::int,(item->>'validFrom')::date,(item->>'validUntil')::date,(item->>'verifiedAt')::timestamptz);end loop;
  delete from public.tour_schedules where tour_id=tid;
  for item in select value from jsonb_array_elements(d->'departures') loop insert into public.tour_schedules(tour_id,weekdays,departure_time,valid_from,valid_until) values(tid,array(select jsonb_array_elements_text(item->'weekdays'))::int[],(item->>'time')::time,(item->>'validFrom')::date,(item->>'validUntil')::date);end loop;
  -- Never delete booked slots or change their reservation counts through the editor.
  if exists(select 1 from public.tour_availability a where a.tour_id=tid and a.reserved>0 and not exists(select 1 from jsonb_array_elements(d->'slots') s where (s->>'date')::date=a.service_date and (s->>'time')::time=a.departure_time and (s->>'reserved')::int=a.reserved)) then raise exception 'Booked slot protected';end if;
  for item in select value from jsonb_array_elements(d->'slots') loop
   if coalesce((select reserved from public.tour_availability where tour_id=tid and service_date=(item->>'date')::date and departure_time=(item->>'time')::time),0)<>(item->>'reserved')::int then raise exception 'Reservation count protected';end if;
  end loop;
  -- Retain slot IDs and references; only missing, unbooked slots may be removed.
  delete from public.tour_availability a where a.tour_id=tid and a.reserved=0 and not exists(select 1 from jsonb_array_elements(d->'slots') s where (s->>'date')::date=a.service_date and (s->>'time')::time=a.departure_time);
  for item in select value from jsonb_array_elements(d->'slots') loop
   insert into public.tour_availability(tour_id,service_date,departure_time,capacity,reserved,status,verified_at) values(tid,(item->>'date')::date,(item->>'time')::time,(item->>'capacity')::int,(item->>'reserved')::int,(item->>'status')::public.slot_status,(item->>'verifiedAt')::timestamptz)
   on conflict(tour_id,service_date,departure_time) do update set capacity=excluded.capacity,status=excluded.status,verified_at=excluded.verified_at;
  end loop;
  if d->>'status'='published' and ((d->>'durationMinutes')::int is null or not exists(select 1 from public.tour_images where tour_id=tid) or exists(select 1 from public.tour_translations where tour_id=tid and coalesce(length(trim(array_to_string(description,' '))),0)=0)) then raise exception 'Required publication information missing';end if;
  update public.tours set status=(d->>'status')::public.tour_status where id=tid returning updated_at into stamp;
  d=d||jsonb_build_object('updatedAt',stamp);
  insert into public.admin_tour_documents(tour_id,document) values(tid,d) on conflict(tour_id) do update set document=excluded.document;
  insert into public.admin_audit_events(actor_id,tour_id,action,old_status,new_status) values(auth.uid(),tid,case when prior.id is null then 'create' when (d->>'archived')::boolean then 'archive' else 'save' end,prior.status::text,d->>'status');
  result=result||jsonb_build_array(d);
 end loop;
 return result;
end $$;
revoke all on function public.admin_inventory(uuid),public.admin_overview(),public.admin_save_batch(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.admin_inventory(uuid),public.admin_overview(),public.admin_save_batch(jsonb,jsonb) to authenticated;
commit;
