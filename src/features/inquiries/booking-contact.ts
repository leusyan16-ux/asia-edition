import { z } from "zod";

export const bookingRequestSchema = z.object({
  name:z.string().trim().min(1).max(120),
  date:z.iso.date(),
  adults:z.coerce.number().int().min(1).max(30),
  children:z.coerce.number().int().min(0).max(20),
  message:z.string().trim().max(1000),
  consent:z.literal(true),
}).refine(v=>v.adults+v.children<=30,{message:"Maximum 30 guests",path:["adults"]});

export function bookingEmail(value: string | undefined) {
  const result=z.email().max(254).safeParse(value?.trim());
  return result.success && !/[\r\n?&#]/.test(result.data) ? result.data : null;
}

function bookingMessage(product:{title:string;slug:string},input:unknown,locale:"ru"|"en",today:string) {
  const request=bookingRequestSchema.parse(input);
  if(request.date<today)throw Error("Choose a future date");
  if(!/^[a-z0-9-]+$/.test(product.slug))throw Error("Invalid product");
  const subject=`ASIA EDITION · ${product.title.replace(/[\r\n]/g,' ').slice(0,180)}`;
  const body=locale==='ru'?
    `Запрос на бронирование\nЭкскурсия: ${product.title}\nСсылка: https://asia-edition.vercel.app/ru/tours/${product.slug}\nИмя: ${request.name}\nЖелаемая дата: ${request.date}\nВзрослых: ${request.adults}\nДетей: ${request.children}\nКомментарий: ${request.message}\n\nПрошу подтвердить доступность и окончательную стоимость. Это запрос, не подтверждённая бронь.`:
    `Booking request\nActivity: ${product.title}\nLink: https://asia-edition.vercel.app/en/tours/${product.slug}\nName: ${request.name}\nPreferred date: ${request.date}\nAdults: ${request.adults}\nChildren: ${request.children}\nMessage: ${request.message}\n\nPlease confirm availability and the final price. This is a request, not a confirmed booking.`;
  return {subject,body};
}
export function bookingMailto(recipient:string,product:{title:string;slug:string},input:unknown,locale:"ru"|"en",today=new Date().toISOString().slice(0,10)) {
  const email=bookingEmail(recipient);if(!email)throw Error("Booking contact unavailable");
  const {subject,body}=bookingMessage(product,input,locale,today);
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
export function bookingTelegramUrl(value:string|undefined) {
  try { const u=new URL(value??'');return u.protocol==='https:'&&u.hostname==='t.me'&&/^\/[a-z0-9_]{1,28}_bot\/?$/i.test(u.pathname)&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash ? u.href.replace(/\/$/,''):null; } catch{return null;}
}
export function bookingTelegramDraft(contact:string,product:{title:string;slug:string},input:unknown,locale:"ru"|"en",today=new Date().toISOString().slice(0,10)) {
 const base=bookingTelegramUrl(contact);if(!base)throw Error('Invalid Telegram contact');
 const {body}=bookingMessage(product,input,locale,today);
 if(product.slug.length>64)throw Error('Product context exceeds Telegram limit');
 const u=new URL(base);u.searchParams.set('start',product.slug);
 return {text:body,url:u.href};
}
