import "server-only";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { requireCommerceStaff } from "./server";
import type {ChartPeriod} from "./chart-model";
import {fetchDailyChart} from "./chart-data";

export async function readDailyChart(period:ChartPeriod) {
  const staff=await requireCommerceStaff("/admin/analytics");
  if(!["owner","admin"].includes(staff.role))notFound();
  const key=process.env.COMMERCE_TELEGRAM_SUPABASE_SECRET,url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  if(!key||!url)return {data:null,error:"chart_configuration"};
  // The service role is used only for protected analytics aggregation after Owner/admin AAL2 checks.
  // Requests use the authenticated staff client and its existing RLS, not the service role.
  const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  try{return {data:await fetchDailyChart(period,new Date(),service,staff.client),error:null};}
  catch(error){
    console.error("commerce_chart",error instanceof Error&&/^[a-z_]+$/.test(error.message)?error.message:"unavailable");
    return {data:null,error:"chart_unavailable"};
  }
}
