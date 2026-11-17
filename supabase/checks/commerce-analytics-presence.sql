-- READ ONLY. Run only in staging xnnxmhwvixrqenunhhbt.
select name as table_name,
  to_regclass('public.'||name) is not null as exists_in_database,
  has_schema_privilege('service_role','public','USAGE') as service_schema_usage,
  has_table_privilege('service_role',to_regclass('public.'||name),'SELECT') as service_can_select
from (values ('commerce_analytics_daily'),('commerce_order_crm'),('commerce_customer_notes')) t(name);

select signature,
  to_regprocedure(signature) is not null as exists_in_database,
  has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role',to_regprocedure(signature),'EXECUTE') as service_execute
from (values
 ('public.commerce_dashboard(integer)'),
 ('public.commerce_record_event(text,text,text,text,text,text,text,text)'),
 ('public.commerce_customers(text,date,date,integer,text,uuid)')
) f(signature);
