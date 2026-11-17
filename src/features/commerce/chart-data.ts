import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {afterChartCursor,dailyChartData,dateDaysAgo,type ChartPeriod} from "./chart-model";

/** Private aggregate loader. Callers must authorize before passing database clients. */
export async function fetchDailyChart(period:ChartPeriod,now:Date,service:SupabaseClient,orders:SupabaseClient) {
  const today=now.toISOString().slice(0,10),since=dateDaysAgo(today,period-1);
  const visits=new Map<string,number>(),requests=new Map<string,number>();
    const visitKeys=["day","visitor_hash","path","detail","country","city","device","referrer"] as const;
    let cursor:Record<string,string>|null=null,complete=false;
    for(let page=0;page<200;page++){
      let query=service.from("commerce_analytics_daily").select(visitKeys.join(",")+",hits")
        .eq("event","visit").gte("day",since>dateDaysAgo(today,35)?since:dateDaysAgo(today,35)).lte("day",today).limit(500);
      for(const field of visitKeys)query=query.order(field,{ascending:true});
      if(cursor)query=query.or(afterChartCursor(visitKeys,cursor));
      const result=await query;
      if(result.error)throw Error("visits_query");
      const rows=result.data as unknown as (Record<string,string>&{hits:number})[];
      for(const row of rows){if(!Number.isSafeInteger(row.hits)||row.hits<1)throw Error("invalid_count");visits.set(row.day,(visits.get(row.day)??0)+row.hits);}
      if(rows.length<500){complete=true;break;}cursor=rows[rows.length-1];
    }
    if(!complete)throw Error("visits_limit");
    cursor=null;complete=false;
    for(let page=0;page<200;page++){
      let query=orders.from("commerce_orders").select("id,created_at")
        .gte("created_at",since+"T00:00:00Z").lte("created_at",now.toISOString())
        .not("contact_email","like","%@example.invalid").order("created_at").order("id").limit(500);
      if(cursor)query=query.or(afterChartCursor(["created_at","id"],cursor));
      const result=await query;if(result.error)throw Error("requests_query");
      for(const row of result.data){const day=new Date(row.created_at).toISOString().slice(0,10);requests.set(day,(requests.get(day)??0)+1);}
      if(result.data.length<500){complete=true;break;}cursor=result.data[result.data.length-1];
    }
    if(!complete)throw Error("requests_limit");
    return dailyChartData(period,today,visits,requests);

}
