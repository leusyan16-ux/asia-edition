"use client";
import { commerceAPI, CommerceAPIError } from "./client-api";
import { readGuestCart, syncGuestCart } from "./cart-sync";

export const favoritesKey = "asia-edition-favorites-v1";
let cartCount = 0;
let favorites: string[] = [];
let identity: boolean | null = null;
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(fn => fn()); }
export function subscribeCommerce(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export const cartSnapshot = () => cartCount;
export const favoritesSnapshot = () => favorites;
export function readLocalFavorites() {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(favoritesKey) ?? "[]");
    return Array.isArray(data) ? [...new Set(data.filter((s): s is string => typeof s === "string" && /^[a-z0-9-]{1,150}$/.test(s)))].slice(0,200) : [];
  } catch { return []; }
}
export function announceCart(count?: number) {
  if (count !== undefined) { cartCount=count; emit(); }
  else window.dispatchEvent(new Event("ae-cart-changed"));
}
export function refreshCommerceState() {
  if (loading) return loading;
  loading = (async () => {
    let guest = 0;
    try { guest=readGuestCart(localStorage).length; } catch {}
    favorites=readLocalFavorites();cartCount=guest;emit();
    try {
      const session = await commerceAPI("session?view=cart");
      identity=Boolean(session?.user);
      if (identity) {
        const cart=guest ? await syncGuestCart(commerceAPI,localStorage) : session.cart;
        cartCount=cart?.items?.length ?? 0;
        const local=readLocalFavorites();
        for (const slug of local) await commerceAPI("favorite",{slug});
        const saved=await commerceAPI("favorites") as {product_slug:string}[];
        favorites=[...new Set(saved.map(item=>item.product_slug))];
        // Remove only the guest additions acknowledged by the server.
        const remaining=readLocalFavorites().filter(slug=>!local.includes(slug));
        if(remaining.length) localStorage.setItem(favoritesKey,JSON.stringify(remaining));
        else localStorage.removeItem(favoritesKey);
      }
    } catch { /* Keep guest data during connection failures. */ }
    emit();
  })().finally(()=>{loading=undefined;});
  return loading;
}
export async function toggleFavorite(slug: string) {
  if (identity===null) await refreshCommerceState();
  const remove=favorites.includes(slug);
  if(identity) {
    try { await commerceAPI("favorite",{slug,remove}); }
    catch(error) {
      if (!(error instanceof CommerceAPIError && error.status===401)) throw error;
      identity=false;
    }
  }
  const next=remove ? favorites.filter(s=>s!==slug) : [...new Set([...favorites,slug])];
  if(!identity) localStorage.setItem(favoritesKey,JSON.stringify(next));
  favorites=next;emit();
  return {saved:!remove,guest:!identity};
}
