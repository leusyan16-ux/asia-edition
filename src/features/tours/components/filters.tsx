'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { countries,type Locale } from '@/lib/catalog';
import type { TourQuery,TourTaxonomy } from '../model';
import { tourLabels } from '../labels';
export function TourFilters({query,locale,taxonomy}:{query:TourQuery;locale:Locale;taxonomy:TourTaxonomy}){
 const t=tourLabels[locale];const [country,setCountry]=useState(query.country??'');const [location,setLocation]=useState(query.location??'');
 return <form className="tour-filters" action={`/${locale}/tours`} method="get"><div className="catalog-search"><Search size={18}/><label className="sr-only" htmlFor="catalog-search">{t.search}</label><input id="catalog-search" name="search" type="search" maxLength={120} defaultValue={query.search} placeholder={t.search}/></div>
 <div className="filter-grid"><label>{t.country}<select aria-label={t.country} name="country" value={country} onChange={e=>{setCountry(e.target.value);setLocation('')}}><option value="">{t.all}</option>{countries.filter(c=>taxonomy.locations.some(l=>l.country===c.slug)).map(c=><option key={c.slug} value={c.slug}>{c.name[locale]}</option>)}</select></label>
 <label>{t.city}<select aria-label={t.city} name="location" value={location} onChange={e=>setLocation(e.target.value)}><option value="">{t.all}</option>{taxonomy.locations.filter(l=>!country||l.country===country).map(l=><option key={`${l.country}-${l.slug}`} value={l.slug}>{l.name[locale]}</option>)}</select></label>
 <label>{t.category}<select aria-label={t.category} name="category" defaultValue={query.category??''}><option value="">{t.all}</option>{taxonomy.categories.map(c=><option key={c.slug} value={c.slug}>{c.name[locale]}</option>)}</select></label>
 <label>{t.duration}<select aria-label={t.duration} name="duration" defaultValue={query.duration??''}><option value="">{t.all}</option>{(['short','half','full','multi'] as const).map(v=><option key={v} value={v}>{t[v]}</option>)}</select></label>
 <label>{t.currency}<select aria-label={t.currency} name="currency" defaultValue={query.currency??'USD'}>{['USD','EUR','RUB','THB','VND','CNY','TRY','AED','IDR','LKR','MVR','INR','MYR','PHP','KRW','JPY'].map(c=><option key={c}>{c}</option>)}</select></label>
 <label>{t.min}<input name="minPrice" type="number" min="0" step="0.01" defaultValue={query.minPrice}/></label><label>{t.max}<input name="maxPrice" type="number" min="0" step="0.01" defaultValue={query.maxPrice}/></label>
 <label>{t.sort}<select aria-label={t.sort} name="sort" defaultValue={query.sort??'featured'}><option value="featured">{t.featured}</option><option value="price-asc">{t.priceAsc}</option><option value="price-desc">{t.priceDesc}</option><option value="duration">{t.durationSort}</option></select></label></div>
 <div className="filter-actions"><button className="primary-button" type="submit">{t.apply}</button><Link href={`/${locale}/tours`}>{t.reset}</Link><span>{locale==='ru'?'Цены сравниваются только в выбранной валюте.':'Prices are compared only within the selected currency.'}</span></div></form>;
}

