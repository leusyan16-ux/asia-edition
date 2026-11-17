import {createClient} from "@supabase/supabase-js";
import {fetchDailyChart} from "../src/features/commerce/chart-data";
import {afterChartCursor} from "../src/features/commerce/chart-model";
const ref="xnnxmhwvixrqenunhhbt";
async function main(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.COMMERCE_TELEGRAM_SUPABASE_SECRET;
  if(process.env.VERCEL_ENV!=="preview"||process.env.COMMERCE_STAGING_PROJECT_REF!==ref||!url||new URL(url).href!==`https://${ref}.supabase.co/`||!key)throw Error("staging_configuration");
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const now=new Date();
  const first=await client.from("commerce_orders").select("id,created_at").order("created_at").order("id").limit(1);
  if(first.error)throw Error("cursor_read");
  if(first.data.length){
    const next=await client.from("commerce_orders").select("id").order("created_at").order("id")
      .or(afterChartCursor(["created_at","id"],first.data[0])).limit(1);
    if(next.error)throw Error("cursor_query");
    console.log("DAILY_CHART","PostgREST keyset cursor accepted; no identities logged");
  }
  for(const period of [7,30,90] as const){
    // Build-time read-only query verification; no user identity is fabricated.
    // The deployed page instead passes its authenticated Owner/admin client for orders.
    const chart=await fetchDailyChart(period,now,client,client);
    if(chart.points.length!==period||chart.points.some(p=>p.requests<0||(p.visits!==null&&p.visits<0)))throw Error("chart_shape");
    console.log("DAILY_CHART",JSON.stringify({period,days:chart.points.length,knownVisitDays:chart.knownVisitDays,visits:chart.points.reduce((n,p)=>n+(p.visits??0),0),requests:chart.points.reduce((n,p)=>n+p.requests,0)}));
  }
}
main().catch(()=>{console.error("DAILY_CHART","read_only_verification_failed");process.exitCode=1;});
