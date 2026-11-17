import Link from 'next/link';
import type { Locale } from '@/lib/catalog';
import { getTourRepository } from '../repository';
import { TourCards } from './cards';
import { tourLabels } from '../labels';
export async function DestinationCatalog({locale,country,location}:{locale:Locale;country:string;location?:string}){
 const t=tourLabels[locale];const result=await getTourRepository().list({locale,country,location,page:1,pageSize:3,sort:'featured'});
 const query=new URLSearchParams({country,...(location?{location}:{})});
 return <section className={`section country-tour-section ${location?'destination-tour-section':''}`}><h2>{location?t.destinationTours:t.countryTours}</h2>{result.items.length?<TourCards items={result.items} locale={locale}/>:<p>{t.awaiting}</p>}<Link className="text-link" href={`/${locale}/tours?${query}`}>{t.openCatalog}</Link></section>;
}

