import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { allowAnalyticsEvent,allowAuthAttempt } from "../src/features/commerce/rate-limit";
import { staticCatalogRepository } from "../src/features/tours/static-catalog";
import { favoritesKey,refreshCommerceState,toggleFavorite,favoritesSnapshot,cartSnapshot,announceCart } from "../src/features/commerce/browser-state";
import { guestCartKey } from "../src/features/commerce/cart-sync";

test("analytics permits normal browsing without weakening sign-in throttling",()=>{
  for(let i=0;i<120;i++) assert.equal(allowAnalyticsEvent("fixture-visit",1000),true);
  assert.equal(allowAnalyticsEvent("fixture-visit",1000),false);
  assert.equal(allowAnalyticsEvent("fixture-visit",62000),true);
  for(let i=0;i<10;i++)assert.equal(allowAuthAttempt("fixture-login",1000),true);
  assert.equal(allowAuthAttempt("fixture-login",1000),false);
});

test("editorial holds remove listings and direct details, preserving the source snapshot",async()=>{
  const raw=await readFile("src/features/tours/published-catalog.json","utf8");
  const source=JSON.parse(raw),repository=staticCatalogRepository(source);
  assert.equal(source.records.length,2319);
  assert.equal(await repository.bySlug("getyourguide-1514696"),null);
  assert.equal(await repository.bySlug("getyourguide-632479"),null);
  assert.equal((await repository.list({locale:"ru",page:1,pageSize:9})).total,2317);
  assert(!(await repository.taxonomy()).locations.some(l=>l.country==="myanmar"));
  assert.equal(JSON.stringify(source),JSON.stringify(JSON.parse(raw)));
});

test("guest favorites toggle, merge after login without duplicates, and cart count updates immediately",async()=>{
  const originalFetch=globalThis.fetch;
  const entries=new Map<string,string>();
  const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
  const originalStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"localStorage",{value:storage,configurable:true});
  let signedIn=false,cart={items:[] as unknown[],revision:0};const saved=new Set<string>();
  globalThis.fetch=async(url,init)=>{
    const path=String(url).split("/").pop()!;
    const body=init?.body?JSON.parse(String(init.body)):null;
    let result:unknown=null;
    if(path.startsWith("session"))result=signedIn?{user:{id:"fixture"},cart}:null;
    else if(path==="cart"){
      if(body){cart={items:body.items,revision:cart.revision+1};result={ok:true};}else result=cart;
    } else if(path==="favorite") {if(body.remove)saved.delete(body.slug);else saved.add(body.slug);result={ok:true};}
    else if(path==="favorites")result=[...saved].map(product_slug=>({product_slug}));
    return new Response(JSON.stringify(result),{status:200,headers:{"Content-Type":"application/json"}});
  };
  try{
    await refreshCommerceState();
    assert.equal((await toggleFavorite("getyourguide-127")).guest,true);
    assert.deepEqual(favoritesSnapshot(),["getyourguide-127"]);
    await toggleFavorite("getyourguide-127");assert.deepEqual(favoritesSnapshot(),[]);
    await toggleFavorite("getyourguide-127");
    storage.setItem(guestCartKey,JSON.stringify([{slug:"getyourguide-127",date:"2027-01-01",adults:2,children:0,options:""}]));
    announceCart(1);assert.equal(cartSnapshot(),1);
    signedIn=true;await refreshCommerceState();
    assert.equal(saved.size,1);assert.equal(storage.getItem(favoritesKey),null);
    assert.equal(cartSnapshot(),1);assert.equal(cart.items.length,1);
    await refreshCommerceState();assert.equal(saved.size,1);assert.equal(cart.items.length,1);
    await toggleFavorite("getyourguide-127");assert.equal(saved.size,0);
  } finally {
    globalThis.fetch=originalFetch;
    if(originalStorage)Object.defineProperty(globalThis,"localStorage",originalStorage);
    else Reflect.deleteProperty(globalThis,"localStorage");
  }
});
