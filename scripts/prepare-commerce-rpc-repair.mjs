import { readFile, writeFile } from "node:fs/promises";
const source=await readFile("supabase/migrations/202611110010_commerce_crm_analytics.sql","utf8");
const signatures={
  commerce_customers:"public.commerce_customers(text,date,date,integer,text,uuid)",
  commerce_record_event:"public.commerce_record_event(text,text,text,text,text,text,text,text)",
  commerce_dashboard:"public.commerce_dashboard(integer)",
};
const definitions=[...source.matchAll(/create function public\.(commerce_customers|commerce_record_event|commerce_dashboard)\([\s\S]*?\$\$;/g)];
if(definitions.length!==3) throw Error("Expected three original function definitions");
const output=[
  "-- STAGING xnnxmhwvixrqenunhhbt ONLY. Run as postgres.",
  "-- Only missing functions and their EXECUTE permissions are repaired.",
  "-- No tables, records, accounts or existing function bodies are replaced.",
  "begin;",
  `do $preflight$
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
end $preflight$;`,
];
for(const match of definitions) {
  const name=match[1],signature=signatures[name];
  output.push(`do $repair$
begin
  if to_regprocedure('${signature}') is null then
    execute $definition$
${match[0]}
$definition$;
  end if;
end $repair$;`);
}
output.push(
  "revoke execute on function public.commerce_customers(text,date,date,integer,text,uuid), public.commerce_dashboard(integer) from public,anon;",
  "grant execute on function public.commerce_customers(text,date,date,integer,text,uuid), public.commerce_dashboard(integer) to authenticated;",
  "revoke execute on function public.commerce_record_event(text,text,text,text,text,text,text,text) from public,anon,authenticated;",
  "grant execute on function public.commerce_record_event(text,text,text,text,text,text,text,text) to service_role;",
  "notify pgrst, 'reload schema';",
  "commit;",
  "select p.oid::regprocedure::text as installed_function from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('commerce_customers','commerce_dashboard','commerce_record_event') order by p.proname;",
);
await writeFile("supabase/commerce-analytics-functions-repair.sql",output.join("\n\n")+"\n");
console.log("Prepared three guarded function repairs. No connection or SQL execution.");
