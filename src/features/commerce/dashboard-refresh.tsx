"use client";
import {useEffect,useRef,useTransition} from "react";
import {useRouter} from "next/navigation";
import {RefreshCw} from "lucide-react";
import {scheduleDashboardRefresh} from "./refresh-scheduler";

export function DashboardRefresh({updatedAt}:{updatedAt:string|null}){
  const router=useRouter();
  const [pending,startTransition]=useTransition();
  const busy=useRef(false);
  const refreshNow=useRef<(()=>void)|null>(null);
  useEffect(()=>{busy.current=pending;},[pending]);
  useEffect(()=>{
    const scheduler=scheduleDashboardRefresh({
    refresh:()=>startTransition(()=>router.refresh()),busy:()=>busy.current,
    visible:()=>document.visibilityState==="visible",online:()=>navigator.onLine!==false,now:()=>Date.now(),
    interval:(callback,ms)=>window.setInterval(callback,ms),clear:timer=>window.clearInterval(timer as number),
    listen:(event,callback)=>{const target=event==="visibilitychange"?document:window;target.addEventListener(event,callback);return()=>target.removeEventListener(event,callback);},
    });
    refreshNow.current=scheduler.refreshNow;
    return ()=>{refreshNow.current=null;scheduler();};
  },[router]);
  return <div className="dashboard-refresh">
    <p role="status" aria-live="polite">{pending?"Обновляем статистику…":updatedAt?<>Данные загружены <time dateTime={updatedAt}>{new Intl.DateTimeFormat("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit",timeZone:"UTC"}).format(new Date(updatedAt))} UTC</time></>:"Статистика временно недоступна; повторяем загрузку."}<span>Автообновление каждые 30 с в активной вкладке.</span></p>
    <button type="button" disabled={pending} onClick={()=>refreshNow.current?.()}><RefreshCw size={15} aria-hidden="true"/>{pending?"Обновление…":"Обновить"}</button>
  </div>;
}
