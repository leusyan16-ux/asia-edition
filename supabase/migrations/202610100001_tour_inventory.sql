-- Supabase/PostgreSQL inventory foundation. Apply only to an isolated test project first.
begin;
create type public.tour_status as enum ('draft','published','unavailable');
create type public.location_kind as enum ('city','resort','destination');
create type public.slot_status as enum ('available','sold_out','closed');

create table public.countries (
 slug text primary key check (slug in ('thailand','vietnam','china','turkey','united-arab-emirates','indonesia','sri-lanka','maldives','india','malaysia','philippines','south-korea','japan')),
 name_ru text not null, name_en text not null, priority text not null check(priority in ('main','high','second'))
);
insert into public.countries values
 ('thailand','Таиланд','Thailand','main'),('vietnam','Вьетнам','Vietnam','main'),('china','Китай','China','main'),('turkey','Турция','Turkey','main'),('united-arab-emirates','Объединённые Арабские Эмираты','United Arab Emirates','main'),
 ('indonesia','Индонезия','Indonesia','high'),('sri-lanka','Шри-Ланка','Sri Lanka','high'),('maldives','Мальдивы','Maldives','high'),
 ('india','Индия','India','second'),('malaysia','Малайзия','Malaysia','second'),('philippines','Филиппины','Philippines','second'),('south-korea','Южная Корея','South Korea','second'),('japan','Япония','Japan','second');
create table public.locations (
 id uuid primary key default gen_random_uuid(),country_slug text not null references public.countries(slug),slug text not null,
 kind public.location_kind not null,name_ru text not null,name_en text not null,parent_id uuid,
 asian_territory_verified boolean not null default false,
 unique(country_slug,slug),unique(id,country_slug),
 foreign key(parent_id,country_slug) references public.locations(id,country_slug),check(parent_id is null or parent_id<>id),
 check(country_slug<>'turkey' or asian_territory_verified)
);
create table public.categories (slug text primary key,name_ru text not null,name_en text not null);
insert into public.categories values ('nature','Природа и пейзажи','Nature & landscapes'),('culture','Культура и история','Culture & history'),('sea','Морские прогулки','Boat excursions'),('adventure','Активный отдых','Adventure'),('city','Городские экскурсии','City discovery');
create table public.operators (
 id uuid primary key default gen_random_uuid(),name text not null,verified_at timestamptz,external_reference text unique
);
-- Supplier contacts and contractual details are never exposed to anonymous readers.
create table public.supplier_details (operator_id uuid primary key references public.operators(id) on delete cascade,email text,phone text,contract_reference text,notes text);
create table public.tours (
 id uuid primary key default gen_random_uuid(),slug text not null unique check(slug~'^[a-z0-9-]+$'),country_slug text not null references public.countries(slug),
 location_id uuid not null,category_slug text not null references public.categories(slug),operator_id uuid references public.operators(id),
 status public.tour_status not null default 'draft',is_demo boolean not null default false,verified_at timestamptz,
 featured boolean not null default false,duration_minutes integer check(duration_minutes>0),timezone text not null default 'UTC',
 languages text[] not null default '{}',latitude numeric check(latitude between -90 and 90),longitude numeric check(longitude between -180 and 180),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(location_id,country_slug) references public.locations(id,country_slug),
 unique(id,country_slug),check((latitude is null)=(longitude is null)),
 check(status<>'published' or is_demo or (verified_at is not null and operator_id is not null))
);
create table public.tour_translations (
 tour_id uuid not null references public.tours(id) on delete cascade,locale text not null check(locale in ('ru','en')),
 title text not null check(length(trim(title))>0),summary text not null default '',description text[] not null default '{}',highlights text[] not null default '{}',
 transportation text,schedule text,inclusions text[] not null default '{}',exclusions text[] not null default '{}',meeting text,pickup text,
 cancellation text,booking_conditions text,seo_title text not null default '',seo_description text not null default '',
 primary key(tour_id,locale)
);
create table public.tour_images (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,
 url text not null check(url~'^https://' or url~'^/images/'),alt_ru text not null,alt_en text not null,position integer not null check(position>=0),
 source_url text,credit text,unique(tour_id,position)
);
create table public.tour_itinerary (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,position integer not null check(position>=0),
 title_ru text not null,title_en text not null,description_ru text not null,description_en text not null,duration_minutes integer check(duration_minutes>=0),unique(tour_id,position)
);
create table public.tour_faq (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,position integer not null check(position>=0),
 question_ru text not null,question_en text not null,answer_ru text not null,answer_en text not null,unique(tour_id,position)
);
create table public.tour_pickup_locations (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null,country_slug text not null,location_id uuid not null,
 name_ru text not null,name_en text not null,address_ru text not null,address_en text not null,instructions_ru text,instructions_en text,position integer not null default 0,
 foreign key(tour_id,country_slug) references public.tours(id,country_slug) on delete cascade,
 foreign key(location_id,country_slug) references public.locations(id,country_slug)
);
create table public.tour_meeting_points (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,
 name_ru text not null,name_en text not null,address_ru text not null,address_en text not null,
 latitude numeric check(latitude between -90 and 90),longitude numeric check(longitude between -180 and 180),position integer not null default 0,
 check((latitude is null)=(longitude is null))
);
create table public.tour_prices (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,
 currency text not null check(currency~'^[A-Z]{3}$'),adult numeric(12,2) check(adult>=0),child numeric(12,2) check(child>=0),
 child_min_age integer check(child_min_age>=0),child_max_age integer check(child_max_age>=0),
 valid_from date,valid_until date,verified_at timestamptz,
 check(adult is not null or child is not null),check(child_min_age is null or child_max_age is null or child_min_age<=child_max_age),
 check(valid_from is null or valid_until is null or valid_from<=valid_until)
);
create table public.tour_schedules (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,
 weekdays integer[] not null check(weekdays<@array[0,1,2,3,4,5,6]),departure_time time not null,
 valid_from date not null,valid_until date not null,check(valid_from<=valid_until)
);
-- Slots are authoritative; recurring schedules alone do not imply availability.
create table public.tour_availability (
 id uuid primary key default gen_random_uuid(),tour_id uuid not null references public.tours(id) on delete cascade,
 service_date date not null,departure_time time not null,capacity integer not null check(capacity>=0),reserved integer not null default 0 check(reserved>=0),
 status public.slot_status not null default 'closed',verified_at timestamptz,unique(tour_id,service_date,departure_time),check(reserved<=capacity)
);
create index tours_catalog on public.tours(country_slug,location_id,category_slug) where status='published' and not is_demo;
create index tours_sort on public.tours(featured desc,duration_minutes,slug);
create index prices_lookup on public.tour_prices(tour_id,currency,adult);
create index availability_lookup on public.tour_availability(tour_id,service_date);
create index translation_search on public.tour_translations using gin(to_tsvector('simple',title||' '||summary));

create function public.touch_tour() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
create trigger touch_tour before update on public.tours for each row execute function public.touch_tour();
create function public.validate_publication() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Valid IANA timezone required'; end if;
 if new.status='published' and not new.is_demo then
  if not exists(select 1 from public.operators where id=new.operator_id and verified_at is not null) then raise exception 'Verified operator required'; end if;
  if (select count(*) from public.tour_translations where tour_id=new.id and length(trim(title))>0 and length(trim(array_to_string(description,' ')))>0)<>2 then raise exception 'RU and EN content required'; end if;
  if not exists(select 1 from public.tour_images where tour_id=new.id) then raise exception 'Tour image required'; end if;
 end if;
 return new;
end $$;
create trigger validate_publication before insert or update on public.tours for each row execute function public.validate_publication();

-- All writes are denied to browser roles. Admin writes will need a reviewed server workflow in phase 4.
do $$ declare t text; begin
 foreach t in array array['countries','locations','categories','operators','supplier_details','tours','tour_translations','tour_images','tour_itinerary','tour_faq','tour_pickup_locations','tour_meeting_points','tour_prices','tour_schedules','tour_availability'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  execute format('grant select on public.%I to anon, authenticated',t);
 end loop;
end $$;
-- Internal supplier identifiers are not part of the public operator profile.
revoke select on public.operators from anon,authenticated;
grant select(id,name,verified_at) on public.operators to anon,authenticated;
create policy country_read on public.countries for select to anon,authenticated using(true);
create policy location_read on public.locations for select to anon,authenticated using(true);
create policy category_read on public.categories for select to anon,authenticated using(true);
create policy operator_read on public.operators for select to anon,authenticated using(verified_at is not null);
create policy published_tours on public.tours for select to anon,authenticated using(status='published' and verified_at is not null and not is_demo and exists(select 1 from public.operators where id=operator_id and verified_at is not null));
do $$ declare t text; begin
 foreach t in array array['tour_translations','tour_images','tour_itinerary','tour_faq','tour_schedules','tour_pickup_locations','tour_meeting_points'] loop
  execute format('create policy public_content on public.%I for select to anon,authenticated using(exists(select 1 from public.tours where id=tour_id))',t);
 end loop;
end $$;
create policy verified_prices on public.tour_prices for select to anon,authenticated using(verified_at is not null and (valid_from is null or valid_from<=current_date) and (valid_until is null or valid_until>=current_date) and exists(select 1 from public.tours where id=tour_id));
create policy verified_slots on public.tour_availability for select to anon,authenticated using(verified_at is not null and service_date>=current_date and exists(select 1 from public.tours where id=tour_id));

-- Typed aggregate consumed by the shared template. Missing sections remain null/empty.
-- Public RPCs filter commercial rows explicitly as well as relying on RLS:
-- authenticated administrators (migration 002) and table owners have wider access.
create function public.tour_payload(t public.tours) returns jsonb language sql stable security invoker set search_path='' as $$
select jsonb_build_object(
 'id',t.id,'slug',t.slug,'country',t.country_slug,'location',l.slug,'category',t.category_slug,'status',t.status,'isDemo',t.is_demo,'verifiedAt',t.verified_at,'featured',t.featured,
 'title',jsonb_build_object('ru',r.title,'en',e.title),'summary',jsonb_build_object('ru',r.summary,'en',e.summary),
 'description',jsonb_build_object('ru',r.description,'en',e.description),'highlights',jsonb_build_object('ru',r.highlights,'en',e.highlights),
 'images',coalesce((select jsonb_agg(jsonb_build_object('url',url,'alt',jsonb_build_object('ru',alt_ru,'en',alt_en)) order by position) from public.tour_images where tour_id=t.id),'[]'),
 'durationMinutes',t.duration_minutes,'transportation',case when coalesce(r.transportation,e.transportation) is null then null else jsonb_build_object('ru',coalesce(r.transportation,''),'en',coalesce(e.transportation,'')) end,
 'languages',t.languages,'schedule',case when coalesce(r.schedule,e.schedule) is null then null else jsonb_build_object('ru',coalesce(r.schedule,''),'en',coalesce(e.schedule,'')) end,'timezone',t.timezone,
 'departures',coalesce((select jsonb_agg(jsonb_build_object('weekdays',weekdays,'time',departure_time,'validFrom',valid_from,'validUntil',valid_until) order by departure_time) from public.tour_schedules where tour_id=t.id),'[]'),
 'pickupLocations',coalesce((select jsonb_agg(jsonb_build_object('name',jsonb_build_object('ru',p.name_ru,'en',p.name_en),'address',jsonb_build_object('ru',p.address_ru,'en',p.address_en),'location',loc.slug,'instructions',case when coalesce(p.instructions_ru,p.instructions_en) is null then null else jsonb_build_object('ru',coalesce(p.instructions_ru,''),'en',coalesce(p.instructions_en,'')) end) order by p.position) from public.tour_pickup_locations p join public.locations loc on loc.id=p.location_id where p.tour_id=t.id),'[]'),
 'meetingPoints',coalesce((select jsonb_agg(jsonb_build_object('name',jsonb_build_object('ru',name_ru,'en',name_en),'address',jsonb_build_object('ru',address_ru,'en',address_en),'lat',latitude,'lng',longitude) order by position) from public.tour_meeting_points where tour_id=t.id),'[]'),
 'itinerary',coalesce((select jsonb_agg(jsonb_build_object('title',jsonb_build_object('ru',title_ru,'en',title_en),'description',jsonb_build_object('ru',description_ru,'en',description_en),'durationMinutes',duration_minutes) order by position) from public.tour_itinerary where tour_id=t.id),'[]'),
 'inclusions',jsonb_build_object('ru',r.inclusions,'en',e.inclusions),'exclusions',jsonb_build_object('ru',r.exclusions,'en',e.exclusions),
 'meeting',case when coalesce(r.meeting,e.meeting) is null then null else jsonb_build_object('ru',coalesce(r.meeting,''),'en',coalesce(e.meeting,'')) end,
 'pickup',case when coalesce(r.pickup,e.pickup) is null then null else jsonb_build_object('ru',coalesce(r.pickup,''),'en',coalesce(e.pickup,'')) end,
 'coordinates',case when t.latitude is null then null else jsonb_build_object('lat',t.latitude,'lng',t.longitude) end,
 'prices',coalesce((select jsonb_agg(jsonb_build_object('currency',p.currency,'adult',p.adult,'child',p.child,'childMinAge',p.child_min_age,'childMaxAge',p.child_max_age)) from (select distinct on(tp.currency) tp.* from public.tour_prices tp where tp.tour_id=t.id and tp.verified_at is not null and (tp.valid_from is null or tp.valid_from<=current_date) and (tp.valid_until is null or tp.valid_until>=current_date) order by tp.currency,tp.valid_from desc nulls last,tp.verified_at desc) p),'[]'),
 'availability',coalesce((select jsonb_agg(jsonb_build_object('date',d.service_date,'remaining',d.remaining,'status',d.status) order by d.service_date) from (select a.service_date,max(case when a.status='available' then a.capacity-a.reserved else 0 end) remaining,case when bool_or(a.status='available' and a.capacity>a.reserved) then 'available' when bool_or(a.status='sold_out') then 'sold_out' else 'closed' end status from public.tour_availability a where a.tour_id=t.id and a.verified_at is not null and a.service_date>=current_date group by a.service_date) d),'[]'),
 'cancellation',case when coalesce(r.cancellation,e.cancellation) is null then null else jsonb_build_object('ru',coalesce(r.cancellation,''),'en',coalesce(e.cancellation,'')) end,
 'bookingConditions',case when coalesce(r.booking_conditions,e.booking_conditions) is null then null else jsonb_build_object('ru',coalesce(r.booking_conditions,''),'en',coalesce(e.booking_conditions,'')) end,
 'faq',coalesce((select jsonb_agg(jsonb_build_object('question',jsonb_build_object('ru',question_ru,'en',question_en),'answer',jsonb_build_object('ru',answer_ru,'en',answer_en)) order by position) from public.tour_faq where tour_id=t.id),'[]'),
 'operator',case when o.id is null then null else jsonb_build_object('id',o.id,'name',o.name) end,
 'seo',jsonb_build_object('title',jsonb_build_object('ru',r.seo_title,'en',e.seo_title),'description',jsonb_build_object('ru',r.seo_description,'en',e.seo_description)), 'updatedAt',t.updated_at
)
from public.locations l join public.tour_translations r on r.tour_id=t.id and r.locale='ru' join public.tour_translations e on e.tour_id=t.id and e.locale='en' left join public.operators o on o.id=t.operator_id where l.id=t.location_id;
$$;
create function public.tour_detail(tour_slug text) returns jsonb language sql stable security invoker set search_path='' as $$ select public.tour_payload(t) from public.tours t where t.slug=tour_slug and status='published' and verified_at is not null and not is_demo $$;
create function public.tour_catalog(filters jsonb default '{}') returns jsonb language sql stable security invoker set search_path='' as $$
with matched as (
 select t.*,p.adult sort_price from public.tours t join public.locations l on l.id=t.location_id
 left join lateral(select tp.adult from public.tour_prices tp where tp.tour_id=t.id and tp.currency=coalesce(filters->>'currency','USD') and tp.verified_at is not null and (tp.valid_from is null or tp.valid_from<=current_date) and (tp.valid_until is null or tp.valid_until>=current_date) order by tp.valid_from desc nulls last,tp.verified_at desc limit 1) p on true
 where t.status='published' and t.verified_at is not null and not t.is_demo
 and (coalesce(filters->>'country','')='' or t.country_slug=filters->>'country')
 and (coalesce(filters->>'location','')='' or l.slug=filters->>'location')
 and (coalesce(filters->>'category','')='' or t.category_slug=filters->>'category')
 and (coalesce(filters->>'search','')='' or exists(select 1 from public.tour_translations x where x.tour_id=t.id and (x.title||' '||x.summary) ilike '%'||(filters->>'search')||'%'))
 and (filters->>'minPrice' is null or p.adult>=(filters->>'minPrice')::numeric)
 and (filters->>'maxPrice' is null or p.adult<=(filters->>'maxPrice')::numeric)
 and (coalesce(filters->>'duration','')='' or case filters->>'duration' when 'short' then t.duration_minutes<180 when 'half' then t.duration_minutes>=180 and t.duration_minutes<360 when 'full' then t.duration_minutes>=360 and t.duration_minutes<=720 when 'multi' then t.duration_minutes>720 else false end)
), paged as (
 select * from matched order by
 case when filters->>'sort'='price-asc' then sort_price end asc nulls last,
 case when filters->>'sort'='price-desc' then sort_price end desc nulls last,
 case when filters->>'sort'='duration' then duration_minutes end asc nulls last,
 case when coalesce(filters->>'sort','featured')='featured' then featured end desc,slug
 limit least(greatest(coalesce((filters->>'pageSize')::integer,9),1),50)
 offset (least(greatest(coalesce((filters->>'page')::integer,1),1),10000)-1)*least(greatest(coalesce((filters->>'pageSize')::integer,9),1),50)
)
select jsonb_build_object('items',coalesce((select jsonb_agg(public.tour_payload(t) order by
 case when filters->>'sort'='price-asc' then p.sort_price end asc nulls last,
 case when filters->>'sort'='price-desc' then p.sort_price end desc nulls last,
 case when filters->>'sort'='duration' then p.duration_minutes end asc nulls last,
 case when coalesce(filters->>'sort','featured')='featured' then p.featured end desc,p.slug) from public.tours t join paged p on p.id=t.id),'[]'),'total',(select count(*) from matched));
$$;
revoke execute on function public.tour_payload(public.tours),public.tour_detail(text),public.tour_catalog(jsonb) from public, anon, authenticated;
grant execute on function public.tour_payload(public.tours),public.tour_detail(text),public.tour_catalog(jsonb) to anon,authenticated;
revoke all on function public.touch_tour(),public.validate_publication() from public, anon, authenticated;
commit;
