import { createClient } from "@supabase/supabase-js";
const ref="xnnxmhwvixrqenunhhbt";
const path="/en/analytics-validation-check";
const markers=["qa-consent-denied-november","qa-consent-granted-november"];
async function main() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.COMMERCE_TELEGRAM_SUPABASE_SECRET;
  if(process.env.VERCEL_ENV!=="preview" || process.env.COMMERCE_STAGING_PROJECT_REF!==ref ||
    !url || new URL(url).href!==`https://${ref}.supabase.co/` || !key) throw Error("Wrong staging");
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let passed=false;
  try {
    const result=await db.from("commerce_analytics_daily").select("event,detail,hits,country,city,device")
      .eq("path",path).in("detail",markers);
    if(result.error) throw Error("Analytics verification read failed");
    const denied=(result.data ?? []).filter(row=>row.detail===markers[0]).reduce((n,row)=>n+row.hits,0);
    const granted=(result.data ?? []).filter(row=>row.detail===markers[1]);
    const hits=granted.reduce((n,row)=>n+row.hits,0);
    const expected=process.env.ANALYTICS_QA_FUNNEL==="true" || process.argv.includes("--funnel") ? ["visit","pageview","product","search","filter","cart_add","checkout","request_success"] : ["pageview"];
    console.log("ANONYMOUS_ANALYTICS",JSON.stringify({
      withoutConsent:denied,withConsent:hits,
      events:granted.map(row=>({event:row.event,hits:row.hits})),
      geography:granted.map(row=>({country:row.country,city:row.city,device:row.device})),
    }));
    passed=denied===0 && hits===expected.length && expected.every(event=>granted.filter(row=>row.event===event).reduce((n,row)=>n+row.hits,0)===1);
  } finally {
    const cleaned=await db.from("commerce_analytics_daily").delete().eq("path",path).in("detail",markers);
    if(cleaned.error) throw Error("QA analytics cleanup failed");
    console.log("ANONYMOUS_ANALYTICS","QA rows removed; real visitor records untouched");
  }
  if(!passed) throw Error("Consent ingestion check failed");
}
main().catch(()=>{console.error("ANONYMOUS_ANALYTICS","Verification failed");process.exitCode=1;});
