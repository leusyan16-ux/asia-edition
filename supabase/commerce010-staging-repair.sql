-- ONLY staging xnnxmhwvixrqenunhhbt, SQL Editor role postgres.
-- Add missing 010 objects; retain existing function bodies, rows, users and Owner.
-- Restores original 010 grants and enables RLS; entire repair is transactional.
-- No bootstrap, imports, publication or data backfill. Do not run the old function-only repair.
begin;

do $preflight$
declare item text; fn text; args text;
begin
  foreach item in array array['commerce_orders','commerce_profiles','commerce_staff','commerce_audit'] loop
    if to_regclass('public.'||item) is null then
      raise exception 'Missing migration 008 dependency: public.%',item;
    end if;
  end loop;
  if to_regprocedure('public.commerce_staff_role()') is null then
    raise exception 'Missing migration 008 commerce_staff_role()';
  end if;
  for fn,args in select * from (values
    ('commerce_crm_stage','uuid,text'),
    ('commerce_customers','text,date,date,integer,text,uuid'),
    ('commerce_record_event','text,text,text,text,text,text,text,text'),
    ('commerce_dashboard','integer')
  ) x(fn,args) loop
    if to_regprocedure('public.'||fn||'('||args||')') is null and exists(
      select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=fn
    ) then raise exception 'Unexpected signature for public.%; no changes committed',fn; end if;
  end loop;
end $preflight$;


create table if not exists public.commerce_customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id),
  actor uuid not null references auth.users(id),
  note text not null check(length(note) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.commerce_customer_notes enable row level security;
revoke all on public.commerce_customer_notes from public,anon,authenticated;
grant select,insert on public.commerce_customer_notes to authenticated;
do $policy$ begin
  if not exists(select 1 from pg_policy where polrelid='public.commerce_customer_notes'::regclass and polname='commerce_customer_notes_staff_read') then
    execute $definition$create policy commerce_customer_notes_staff_read on public.commerce_customer_notes
  for select to authenticated using(public.commerce_staff_role() in('owner','admin','manager'));$definition$;
  end if;
end $policy$;
do $policy$ begin
  if not exists(select 1 from pg_policy where polrelid='public.commerce_customer_notes'::regclass and polname='commerce_customer_notes_staff_write') then
    execute $definition$create policy commerce_customer_notes_staff_write on public.commerce_customer_notes
  for insert to authenticated with check(actor=auth.uid() and public.commerce_staff_role() in('owner','admin','manager'));$definition$;
  end if;
end $policy$;
create index if not exists commerce_customer_notes_customer on public.commerce_customer_notes(customer_id,created_at desc);

create table if not exists public.commerce_order_crm (
  order_id uuid primary key references public.commerce_orders(id),
  stage text not null default 'new' check(stage in('new','in_progress','awaiting_customer','awaiting_confirmation','confirmed','completed','cancelled')),
  updated_at timestamptz not null default now()
);
alter table public.commerce_order_crm enable row level security;
revoke all on public.commerce_order_crm from public,anon,authenticated;
grant select on public.commerce_order_crm to authenticated;
do $policy$ begin
  if not exists(select 1 from pg_policy where polrelid='public.commerce_order_crm'::regclass and polname='commerce_order_crm_staff') then
    execute $definition$create policy commerce_order_crm_staff on public.commerce_order_crm for select to authenticated
  using(public.commerce_staff_role() in('owner','admin','manager','support'));$definition$;
  end if;
end $policy$;

do $repair$ begin
  if to_regprocedure('public.commerce_crm_stage(uuid,text)') is null then
    execute $definition$create function public.commerce_crm_stage(oid uuid,target text) returns void
language plpgsql security definer set search_path=pg_catalog as $$
declare old_stage text;
begin
  if not coalesce(public.commerce_staff_role() in('owner','admin','manager'),false) then raise exception 'Forbidden'; end if;
  perform 1 from public.commerce_orders where id=oid for update;
  if not found then raise exception 'Order missing'; end if;
  select stage into old_stage from public.commerce_order_crm where order_id=oid;
  insert into public.commerce_order_crm(order_id,stage) values(oid,target)
    on conflict(order_id) do update set stage=excluded.stage,updated_at=now();
  insert into public.commerce_audit(actor,action,resource,old_value,new_value)
    values(auth.uid(),'internal_crm_stage',oid,jsonb_build_object('stage',coalesce(old_stage,'new')),jsonb_build_object('stage',target));
end $$;$definition$;
  end if;
end $repair$;
revoke execute on function public.commerce_crm_stage(uuid,text) from public,anon;
grant execute on function public.commerce_crm_stage(uuid,text) to authenticated;

do $repair$ begin
  if to_regprocedure('public.commerce_customers(text,date,date,integer,text,uuid)') is null then
    execute $definition$create function public.commerce_customers(q text default '',since_date date default null,until_date date default null,page_number integer default 1,ordering text default 'newest',subject uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if not coalesce(public.commerce_staff_role() in('owner','admin','manager'),false) then raise exception 'Forbidden'; end if;
  if length(q)>120 or page_number not between 1 and 10000 then raise exception 'Invalid parameters'; end if;
  with customers as (
    select u.id,u.created_at,u.email,u.email_confirmed_at,
      coalesce(p.display_name,'') as name,coalesce(p.phone,'') as phone,
      case when u.banned_until>now() then 'blocked' else 'active' end as account_status,
      (select count(*) from public.commerce_orders o where o.customer_id=u.id) as requests,
      (select max(created_at) from public.commerce_orders o where o.customer_id=u.id) as last_request
    from auth.users u left join public.commerce_profiles p on p.user_id=u.id
    where (subject is null or u.id=subject) and (since_date is null or u.created_at>=since_date)
      and (until_date is null or u.created_at<until_date+1)
      and (q='' or position(lower(q) in lower(coalesce(u.email,'')||' '||coalesce(p.display_name,'')||' '||coalesce(p.phone,'')))>0)
  ), selected as (
    select * from customers
    order by case when ordering='oldest' then created_at end asc,
      case when ordering='requests' then requests end desc,
      created_at desc,id
    limit 50 offset (page_number-1)*50
  )
  select jsonb_build_object('total',(select count(*) from customers),'items',coalesce(jsonb_agg(to_jsonb(selected)),'[]'::jsonb))
    into result from selected;
  return result;
end $$;$definition$;
  end if;
end $repair$;
revoke execute on function public.commerce_customers(text,date,date,integer,text,uuid) from public,anon;
grant execute on function public.commerce_customers(text,date,date,integer,text,uuid) to authenticated;

create table if not exists public.commerce_analytics_daily (
  day date not null default current_date,
  visitor_hash text not null check(visitor_hash ~ '^[a-f0-9]{64}$'),
  event text not null check(event in('visit','pageview','catalog','search','filter','product','cart_add','cart_remove','checkout','request_success','telegram','register','login')),
  path text not null check(length(path)<=200),
  detail text not null default '' check(length(detail)<=120),
  country text not null default 'Unknown' check(length(country)<=60),
  city text not null default 'Unknown' check(length(city)<=100),
  device text not null check(device in('mobile','tablet','desktop')),
  referrer text not null default '' check(length(referrer)<=150),
  hits integer not null default 1 check(hits>0),
  primary key(day,visitor_hash,event,path,detail,country,city,device,referrer)
);
alter table public.commerce_analytics_daily enable row level security;
revoke all on public.commerce_analytics_daily from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_analytics_daily to service_role;
create index if not exists commerce_analytics_period on public.commerce_analytics_daily(day,event);

do $repair$ begin
  if to_regprocedure('public.commerce_record_event(text,text,text,text,text,text,text,text)') is null then
    execute $definition$create function public.commerce_record_event(visitor text,event_name text,page_path text,event_detail text,visitor_country text,visitor_city text,visitor_device text,source_host text)
returns void language sql security invoker set search_path=pg_catalog as $$
  insert into public.commerce_analytics_daily(visitor_hash,event,path,detail,country,city,device,referrer)
  values(visitor,event_name,page_path,event_detail,visitor_country,visitor_city,visitor_device,source_host)
  on conflict(day,visitor_hash,event,path,detail,country,city,device,referrer) do update
  set hits=public.commerce_analytics_daily.hits+1;
  delete from public.commerce_analytics_daily where day<current_date-35;
$$;$definition$;
  end if;
end $repair$;
revoke execute on function public.commerce_record_event(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_record_event(text,text,text,text,text,text,text,text) to service_role;

do $repair$ begin
  if to_regprocedure('public.commerce_dashboard(integer)') is null then
    execute $definition$create function public.commerce_dashboard(days_count integer default 7) returns jsonb
language plpgsql security definer set search_path=pg_catalog as $$
declare result jsonb;
begin
  if not coalesce(public.commerce_staff_role() in('owner','admin'),false) then raise exception 'Forbidden'; end if;
  if days_count not in(1,7,30) then raise exception 'Invalid period'; end if;
  with metrics as (select * from public.commerce_analytics_daily where day>=current_date-(days_count-1))
  select jsonb_build_object(
    'period',days_count,
    'visitors_today',(select count(distinct visitor_hash) from public.commerce_analytics_daily where day=current_date),
    'visitor_days',(select count(distinct (day,visitor_hash)) from metrics),
    'converted_visitor_days',(select count(distinct (day,visitor_hash)) from metrics where event='request_success'),
    'visits',(select coalesce(sum(hits),0) from metrics where event='visit'),
    'pageviews',(select coalesce(sum(hits),0) from metrics where event='pageview'),
    'registrations',(select count(*) from auth.users where created_at>=current_date-(days_count-1) and email not like '%@example.invalid'),
    'requests',(select count(*) from public.commerce_orders where created_at>=current_date-(days_count-1) and contact_email not like '%@example.invalid'),
    'in_progress',(select count(*) from public.commerce_order_crm where stage in('in_progress','awaiting_customer','awaiting_confirmation')),
    'completed',(select count(*) from public.commerce_order_crm where stage='completed'),
    'daily',(select coalesce(jsonb_agg(r order by r.day),'[]'::jsonb) from (
      select d::date as day,
        (select count(distinct visitor_hash) from metrics m where m.day=d::date) visitors,
        (select count(*) from public.commerce_orders o where o.created_at>=d and o.created_at<d+interval '1 day' and o.contact_email not like '%@example.invalid') requests
      from generate_series(current_date-(days_count-1),current_date,interval '1 day') d
    ) r),
    'geography',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (
      select country,city,sum(hits) visits from metrics where event='visit'
      group by country,city order by visits desc limit 30
    ) r),
    'events',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (
      select event,sum(hits) count from metrics group by event order by count desc
    ) r),
    'popular',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (
      select event,path,detail,sum(hits) count from metrics where event in('product','cart_add','search','filter')
      group by event,path,detail order by count desc limit 30
    ) r),
    'devices',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (
      select device,sum(hits) count from metrics where event='visit' group by device
    ) r),
    'destinations',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (
      select split_part(detail,'/',1) country,split_part(detail,'/',2) city,sum(hits) count
      from metrics where event='product' and detail like '%/%'
      group by split_part(detail,'/',1),split_part(detail,'/',2) order by count desc limit 20
    ) r),
    'sources',(select coalesce(jsonb_agg(r),'[]'::jsonb) from (
      select referrer,sum(hits) count from metrics where event='visit' group by referrer order by count desc limit 20
    ) r)
  ) into result;
  return result;
end $$;$definition$;
  end if;
end $repair$;
revoke execute on function public.commerce_dashboard(integer) from public,anon;
grant execute on function public.commerce_dashboard(integer) to authenticated;
notify pgrst, 'reload schema';
commit;
select 'public.'||name as object_name,to_regclass('public.'||name) is not null as exists_in_database
from unnest(array['commerce_customer_notes','commerce_order_crm','commerce_analytics_daily']) name;
select oid::regprocedure::text as installed_function from pg_proc
where pronamespace='public'::regnamespace and proname in('commerce_customers','commerce_dashboard','commerce_record_event','commerce_crm_stage');
