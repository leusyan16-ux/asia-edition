import { redirect } from 'next/navigation';
import { defaultLocale } from '@/lib/catalog';
export default function RootPage(){redirect(`/${defaultLocale}`);}
