"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { commerceAPI } from "./client-api";
import { Heart } from "lucide-react";
import type { Locale } from "@/lib/catalog";
import { favoritesSnapshot, subscribeCommerce, toggleFavorite } from "./browser-state";
const empty: string[]=[];
export function FavoriteButton({slug,locale,compact=false}:{slug:string;locale:Locale;compact?:boolean}) {
  const items=useSyncExternalStore(subscribeCommerce,favoritesSnapshot,()=>empty);
  const saved=items.includes(slug),ru=locale==="ru";
  const [pending,setPending]=useState(false),[message,setMessage]=useState("");
  const label=saved?(ru?"Убрать из избранного":"Remove from favorites"):(ru?"В избранное":"Save to favorites");
  return <div className={compact?"favorite-control compact":"favorite-control"}>
    <button type="button" className="favorite-toggle" aria-label={label} title={label} aria-pressed={saved} disabled={pending} onClick={async()=>{
      setPending(true);
      try {const result=await toggleFavorite(slug);setMessage(result.saved?(result.guest?(ru?"Сохранено в браузере. Войдите для синхронизации.":"Saved in this browser. Sign in to sync."):(ru?"Сохранено в избранном":"Saved to favorites")):(ru?"Удалено из избранного":"Removed from favorites"));}
      catch{setMessage(ru?"Не удалось сохранить. Повторите.":"Unable to save. Please retry.");}
      finally{setPending(false);}
    }}><Heart size={20} fill={saved?"currentColor":"none"}/>{!compact&&<span>{label}</span>}</button>
    <span className={compact?"sr-only":""} role="status">{message}</span>
  </div>;
}
export function GuestFavorites({locale}:{locale:Locale}) {
  const items=useSyncExternalStore(subscribeCommerce,favoritesSnapshot,()=>empty);
  const [titles,setTitles]=useState<Record<string,string>>({});
  useEffect(()=>{
    let active=true;
    const batches=Array.from({length:Math.ceil(items.length/20)},(_,i)=>items.slice(i*20,i*20+20));
    void Promise.all(batches.map(slugs=>commerceAPI("products?slugs="+slugs.join(","))))
      .then(groups=>{if(active)setTitles(Object.fromEntries(groups.flat().map((p:{slug:string;title:Record<Locale,string>})=>[p.slug,p.title[locale]])));}).catch(()=>{});
    return ()=>{active=false;};
  },[items,locale]);
  return <section><h2>{locale==="ru"?"Избранное в этом браузере":"Favorites in this browser"}</h2>
    <p>{locale==="ru"?"Войдите, чтобы сохранить избранное в аккаунте.":"Sign in to save your favorites to your account."}</p>
    {!items.length&&<p>{locale==="ru"?"Нажмите сердечко на понравившейся экскурсии.":"Tap the heart on an activity you like."}</p>}
    {items.map(slug=><div className="commerce-row" key={slug}><Link href={`/${locale}/tours/${slug}`}>{titles[slug]??(locale==="ru"?"Открыть экскурсию":"View activity")}</Link><FavoriteButton slug={slug} locale={locale}/></div>)}
  </section>;
}
