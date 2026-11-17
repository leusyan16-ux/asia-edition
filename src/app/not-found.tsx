import Link from 'next/link';
import { defaultLocale } from '@/lib/catalog';
export default function NotFound(){return <html lang={defaultLocale}><body style={{fontFamily:'sans-serif',padding:'4rem'}}><h1>Страница не найдена / Page not found</h1><Link href={`/${defaultLocale}`}>Открыть Юго-Восточную Азию / Explore Southeast Asia</Link></body></html>;}
