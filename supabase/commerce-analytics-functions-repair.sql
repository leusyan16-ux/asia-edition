-- STAGING xnnxmhwvixrqenunhhbt ONLY. Run as postgres.

-- Only missing functions and their EXECUTE permissions are repaired.

-- No tables, records, accounts or existing function bodies are replaced.

begin;

do $preflight$
declare item text; signature text; function_name text; existing text;
begin
  foreach item in array array['commerce_orders','commerce_profiles','commerce_staff','commerce_analytics_daily','commerce_order_crm'] loop
    if to_regclass('public.'||item) is null then
      raise exception 'Required table public.% is absent. Stop: function-only repair cannot create the missing table.',item;
    end if;
  end loop;
  if to_regprocedure('public.commerce_staff_role()') is null then
    raise exception 'Required commerce_staff_role() from migration 008 is absent';
  end if;
  foreach signature in array array[
    'public.commerce_customers(text,date,date,integer,text,uuid)',
    'public.commerce_record_event(text,text,text,text,text,text,text,text)',
    'public.commerce_dashboard(integer)'
  ] loop
    function_name=split_part(split_part(signature,'.',2),'(',1);
    if to_regprocedure(signature) is null then
      select string_agg(p.oid::regprocedure::text,', ') into existing
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=function_name;
      if existing is not null then
        raise exception 'Unexpected existing signature(s): %. Stop before adding an ambiguous overload.',existing;
      end if;
    end if;
  end loop;
end $preflight$;

do $repair$
begin
  if to_regprocedure('public.commerce_customers(text,date,date,integer,text,uuid)') is null then
    execute $definition$
create function public.commerce_customers(q text default '',since_date date default null,until_date date default null,page_number integer default 1,ordering text default 'newest',subject uuid default null)
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
end $$;
$definition$;
  end if;
end $repair$;

do $repair$
begin
  if to_regprocedure('public.commerce_record_event(text,text,text,text,text,text,text,text)') is null then
    execute $definition$
create function public.commerce_record_event(visitor text,event_name text,page_path text,event_detail text,visitor_country text,visitor_city text,visitor_device text,source_host text)
returns void language sql security invoker set search_path=pg_catalog as $$
  insert into public.commerce_analytics_daily(visitor_hash,event,path,detail,country,city,device,referrer)
  values(visitor,event_name,page_path,event_detail,visitor_country,visitor_city,visitor_device,source_host)
  on conflict(day,visitor_hash,event,path,detail,country,city,device,referrer) do update
  set hits=public.commerce_analytics_daily.hits+1;
  delete from public.commerce_analytics_daily where day<current_date-35;
$$;
$definition$;
  end if;
end $repair$;

do $repair$
begin
  if to_regprocedure('public.commerce_dashboard(integer)') is null then
    execute $definition$
create function public.commerce_dashboard(days_count integer default 7) returns jsonb
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
end $$;
$definition$;
  end if;
end $repair$;

revoke execute on function public.commerce_customers(text,date,date,integer,text,uuid), public.commerce_dashboard(integer) from public,anon;

grant execute on function public.commerce_customers(text,date,date,integer,text,uuid), public.commerce_dashboard(integer) to authenticated;

revoke execute on function public.commerce_record_event(text,text,text,text,text,text,text,text) from public,anon,authenticated;

grant execute on function public.commerce_record_event(text,text,text,text,text,text,text,text) to service_role;

notify pgrst, 'reload schema';

commit;

select p.oid::regprocedure::text as installed_function from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('commerce_customers','commerce_dashboard','commerce_record_event') order by p.proname;
