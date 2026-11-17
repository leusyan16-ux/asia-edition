import { readFile, writeFile } from "node:fs/promises";

// Derive the repair from the existing migration, not a second schema definition.
let sql = await readFile("supabase/migrations/202611110010_commerce_crm_analytics.sql", "utf8");
const signatures = {
  commerce_crm_stage: "uuid,text",
  commerce_customers: "text,date,date,integer,text,uuid",
  commerce_record_event: "text,text,text,text,text,text,text,text",
  commerce_dashboard: "integer",
};
const preflight = `
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
`;
sql = sql.replace(/^begin;/, "begin;\n" + preflight);
sql = sql.replace(/create table public\./g, "create table if not exists public.");
sql = sql.replace(/create index (\w+) on/g, "create index if not exists $1 on");
sql = sql.replace(/create function public\.(\w+)\([\s\S]*?\$\$;/g, (definition, name) => {
  if (!signatures[name]) throw Error(`Unexpected function ${name}`);
  return `do $repair$ begin
  if to_regprocedure('public.${name}(${signatures[name]})') is null then
    execute $definition$${definition}$definition$;
  end if;
end $repair$;`;
});
sql = sql.replace(/create policy (\w+) on public\.(\w+)[\s\S]*?;/g, (definition, name, table) =>
  `do $policy$ begin
  if not exists(select 1 from pg_policy where polrelid='public.${table}'::regclass and polname='${name}') then
    execute $definition$${definition}$definition$;
  end if;
end $policy$;`);
sql = sql.replace(/commit;\s*$/, `notify pgrst, 'reload schema';
commit;
select 'public.'||name as object_name,to_regclass('public.'||name) is not null as exists_in_database
from unnest(array['commerce_customer_notes','commerce_order_crm','commerce_analytics_daily']) name;
select oid::regprocedure::text as installed_function from pg_proc
where pronamespace='public'::regnamespace and proname in('commerce_customers','commerce_dashboard','commerce_record_event','commerce_crm_stage');
`);
await writeFile("supabase/commerce010-staging-repair.sql", `-- ONLY staging xnnxmhwvixrqenunhhbt, SQL Editor role postgres.
-- Add missing 010 objects; retain existing function bodies, rows, users and Owner.
-- Restores original 010 grants and enables RLS; entire repair is transactional.
-- No bootstrap, imports, publication or data backfill. Do not run the old function-only repair.
${sql}`);
console.log("Prepared guarded additive staging repair; no database connection.");
