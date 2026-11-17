begin;

create table public.commerce_telegram_outbox (
  order_id uuid primary key references public.commerce_orders(id) on delete cascade,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  next_part integer not null default 0,
  sent_at timestamptz,
  last_error text
);
alter table public.commerce_telegram_outbox enable row level security;
revoke all on public.commerce_telegram_outbox from public, anon, authenticated, service_role;
grant select, update on public.commerce_telegram_outbox to service_role;
create index commerce_telegram_pending on public.commerce_telegram_outbox(next_attempt_at)
  where sent_at is null;

create function public.commerce_telegram_enqueue() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into public.commerce_telegram_outbox(order_id) values(new.id);
  return new;
end $$;
revoke execute on function public.commerce_telegram_enqueue() from public, anon, authenticated, service_role;
create trigger commerce_telegram_enqueue after insert on public.commerce_orders
  for each row execute function public.commerce_telegram_enqueue();

create function public.commerce_telegram_claim(target uuid default null) returns jsonb
language sql security definer set search_path = pg_catalog as $$
  with candidate as (
    select q.order_id from public.commerce_telegram_outbox q
    where q.sent_at is null and q.next_attempt_at <= now()
      and (q.lease_until is null or q.lease_until <= now())
      and (target is null or q.order_id = target)
    order by q.next_attempt_at, q.order_id limit 1 for update skip locked
  ), claimed as (
    update public.commerce_telegram_outbox q
    set lease_id = gen_random_uuid(), lease_until = now() + interval '2 minutes', attempts = q.attempts + 1
    from candidate c where q.order_id = c.order_id returning q.*
  )
  select jsonb_build_object(
    'id', o.id, 'number', o.number, 'created_at', o.created_at, 'email', o.contact_email,
    'name', p.display_name, 'phone', p.phone, 'lease', c.lease_id,
    'attempts', c.attempts, 'next_part', c.next_part,
    'items', (
      select jsonb_agg(jsonb_build_object('slug', i.product_slug, 'title', i.title,
        'destination', i.destination, 'date', i.requested_date, 'adults', i.adults,
        'children', i.children) order by i.id)
      from public.commerce_order_items i where i.order_id = o.id
    )
  )
  from claimed c join public.commerce_orders o on o.id = c.order_id
  left join public.commerce_profiles p on p.user_id = o.customer_id;
$$;
revoke execute on function public.commerce_telegram_claim(uuid) from public, anon, authenticated;
grant execute on function public.commerce_telegram_claim(uuid) to service_role;

commit;
