import { createClient } from "@supabase/supabase-js";
const ref="xnnxmhwvixrqenunhhbt";
async function main() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.COMMERCE_TELEGRAM_SUPABASE_SECRET;
  if(process.env.VERCEL_ENV!=="preview" || process.env.COMMERCE_STAGING_PROJECT_REF!==ref ||
    !url || new URL(url).href!==`https://${ref}.supabase.co/` || !key) throw Error();
  const response=await fetch(url+"/rest/v1/",{
    headers:{apikey:key,Authorization:"Bearer "+key,Accept:"application/openapi+json","Accept-Profile":"public"},
  });
  if(!response.ok) throw Error();
  const schema=await response.json();
  console.log("ANALYTICS_SCHEMA",JSON.stringify({rootKeys:Object.keys(schema)}));
  for(const name of ["commerce_analytics_daily","commerce_order_crm","commerce_customer_notes"]) {
    console.log("ANALYTICS_SCHEMA",JSON.stringify({table:name,columns:Object.keys(schema.definitions?.[name]?.properties ?? schema.components?.schemas?.[name]?.properties ?? {})}));
  }
  for(const [path,methods] of Object.entries(schema.paths ?? {})) {
    if(!/^\/rpc\/commerce_.*(analytic|dashboard|event|customer)/.test(path)) continue;
    const args=methods.post?.parameters?.find(parameter=>parameter.in==="body")?.schema;
    console.log("ANALYTICS_SCHEMA",JSON.stringify({rpc:path,parameters:Object.keys(args?.properties ?? {})}));
  }
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  for(const [table,columns] of [
    ["commerce_analytics_daily","day,visitor_hash,event,path,detail,country,city,device,referrer,hits"],
    ["commerce_order_crm","order_id,stage"],
  ]) {
    const result=await db.from(table).select(columns).limit(0);
    console.log("ANALYTICS_SCHEMA",JSON.stringify({table,code:result.error?.code ?? "ok",
      message:result.error?.message?.slice(0,500)}));
  }
  const event=await db.rpc("commerce_record_event",{
    visitor:"f".repeat(64),event_name:"__invalid_validation_probe__",page_path:"/en",event_detail:"",
    visitor_country:"Unknown",visitor_city:"Unknown",visitor_device:"desktop",source_host:"",
  });
  console.log("ANALYTICS_SCHEMA",JSON.stringify({eventRpcCode:event.error?.code,
    message:event.error?.message?.slice(0,800),hint:event.error?.hint?.slice(0,800)}));
}
main().catch(()=>{console.error("ANALYTICS_SCHEMA","Metadata unavailable");process.exitCode=1;});
