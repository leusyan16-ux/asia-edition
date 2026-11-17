"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { analyticsEvents, type AnalyticsEvent } from "./analytics";
import { consentKey, consentLifetime, cookieConsent, saveConsent, storedConsent, type AnalyticsChoice } from "./consent-storage";

function subscribe(callback: () => void) {
  window.addEventListener("ae-consent", callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener("ae-consent", callback); window.removeEventListener("storage", callback); };
}
function snapshot() {
  try { return storedConsent(localStorage); } catch { return cookieConsent(document.cookie); }
}
function writeCookie(value: AnalyticsChoice) {
  let age=consentLifetime;
  try {const record=JSON.parse(localStorage.getItem(consentKey)??"null");if(typeof record?.expiresAt==="number")age=Math.max(0,Math.min(age,Math.ceil((record.expiresAt-Date.now())/1000)));}catch{}
  document.cookie = `ae-analytics=${value}; Path=/; SameSite=Lax; Max-Age=${age}${location.protocol === "https:" ? "; Secure" : ""}`;
}
export function AnalyticsConsent({ locale }: { locale: "ru" | "en" }) {
  const consent = useSyncExternalStore(subscribe, snapshot, () => null);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const [editing,setEditing]=useState(false);
  const lastRoute=useRef<string|null>(null),visitPending=useRef(false);
  const path = usePathname();
  const query = useSearchParams().toString();
  const ru = locale === "ru";
  useEffect(() => {
    // Keep the server signal aligned, including revocation in another tab.
    if(consent) {
      if(cookieConsent(document.cookie)!==consent)writeCookie(consent);
      try { if(["yes","no"].includes(localStorage.getItem(consentKey)??"")) saveConsent(localStorage,consent); } catch {}
    } else document.cookie = "ae-analytics=; Path=/; SameSite=Lax; Max-Age=0";
    if (consent !== "yes") { lastRoute.current=null; return; }
    const send = async (event: AnalyticsEvent, detail = "") => {
      if(snapshot()!=="yes") return false;
      let referrer="";
      try {const u=new URL(document.referrer);if(u.origin!==location.origin)referrer=u.hostname;}catch{}
      try {
        const response=await fetch("/api/analytics", { method: "POST", headers: { "content-type": "application/json" },
          body:JSON.stringify({event,path,detail,referrer}),keepalive:true });
        return response.ok;
      } catch { return false; }
    };
    const day=new Date().toISOString().slice(0,10);
    try {
      if (sessionStorage.getItem("ae-analytics-visit")!==day && !visitPending.current) {
        visitPending.current=true;
        void send("visit").then(ok=>{if(ok)try{sessionStorage.setItem("ae-analytics-visit",day);}catch{}}).finally(()=>{visitPending.current=false;});
      }
    } catch { /* Optional tracking is skipped when session storage is unavailable. */ }
    const routeKey=path+"?"+query;
    if(lastRoute.current!==routeKey) {
      lastRoute.current=routeKey;
      void send("pageview");
      const params=new URLSearchParams(query);
      if (path.endsWith("/tours")) {
        void send("catalog");
        if (params.get("search")) void send("search", params.get("search")!.slice(0,120));
        for (const field of ["country", "location", "category"])
          if (params.get(field)) void send("filter",(field+"="+params.get(field)).slice(0,120));
      }
      if (/\/tours\/getyourguide-\d+$/.test(path)) void send("product");
    }
    const onEvent = (input: Event) => {
      const data = (input as CustomEvent).detail;
      if (analyticsEvents.includes(data?.event)) void send(data.event,typeof data.detail==="string"?data.detail.slice(0,120):"");
    };
    window.addEventListener("ae-analytics", onEvent);
    return () => window.removeEventListener("ae-analytics", onEvent);
  }, [consent, path, query]);
  const choose = (value: AnalyticsChoice) => {
    try { saveConsent(localStorage,value); } catch {}
    writeCookie(value);
    if(value==="no")try{sessionStorage.removeItem("ae-analytics-visit");}catch{}
    setEditing(false);
    window.dispatchEvent(new Event("ae-consent"));
  };
  if(!ready) return null;
  if (consent && !editing) return <button className="analytics-preferences" onClick={() => setEditing(true)}>
    {ru ? "Настройки конфиденциальности" : "Privacy preferences"}
  </button>;
  return <aside className="analytics-consent" aria-label={ru ? "Конфиденциальность" : "Privacy choices"}>
    <p>{ru
      ? "Мы заботимся о вашей конфиденциальности. С вашего разрешения мы собираем статистику посещений и действий, чтобы улучшать сайт и подбор экскурсий. Подробнее — в "
      : "We care about your privacy. With your permission, we collect statistics about visits and activity to improve the website and help you find the right excursions. Learn more in our "}
      <Link href={`/${locale}/privacy`} aria-label={ru?"Политика конфиденциальности":"Privacy Policy"}>{ru ? "Политике конфиденциальности" : "Privacy Policy"}</Link>.
    </p>
    <div><button className="consent-choice" onClick={() => choose("yes")}>{ru ? "Разрешить" : "Allow"}</button>
      <button className="consent-choice" onClick={() => choose("no")}>{ru ? "Отклонить" : "Decline"}</button>
      {editing&&<button className="consent-cancel" onClick={()=>setEditing(false)}>{ru?"Закрыть":"Close"}</button>}
    </div>
  </aside>;
}
