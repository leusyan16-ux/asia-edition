'use client';
import { useParams } from 'next/navigation';
export default function TourError({reset}:{reset:()=>void}){const ru=useParams().locale==='ru';return <div className="tour-shell catalog-empty"><h1>{ru?'Не удалось загрузить экскурсии':'Unable to load excursions'}</h1><p>{ru?'Проверьте соединение и попробуйте ещё раз.':'Check your connection and try again.'}</p><button className="primary-button" onClick={reset}>{ru?'Повторить':'Try again'}</button></div>;}
