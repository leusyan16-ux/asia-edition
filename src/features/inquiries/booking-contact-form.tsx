"use client";
import {useState} from "react";
import {bookingMailto,bookingTelegramDraft} from "./booking-contact";
export function BookingContactForm({recipient,telegramUrl,product,locale}:{recipient?:string;telegramUrl?:string;product:{title:string;slug:string};locale:"ru"|"en"}){
 const ru=locale==='ru',[status,setStatus]=useState(''),[draft,setDraft]=useState<{text:string;url:string}|null>(null);
 return <section className="inquiry-section" aria-labelledby="booking-request-title">
  <h2 id="booking-request-title">{ru?'Запросить бронирование':'Request a booking'}</h2>
  <p>{ru?`Выберите желаемую дату и состав группы. ${telegramUrl?'Подготовьте текст и отправьте его в Telegram-бот.':'Запрос отправляется через вашу почту;'} доступность и окончательную стоимость необходимо подтвердить отдельно.`:`Choose a preferred date and group size. ${telegramUrl?'Prepare the text and send it to the Telegram bot.':'Send the request using your email application;'} availability and the final price require separate confirmation.`}</p>
  <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);try{const input={name:data.get('name'),date:data.get('date'),adults:data.get('adults'),children:data.get('children'),message:data.get('message'),consent:data.get('consent')==='on'};if(telegramUrl){setDraft(bookingTelegramDraft(telegramUrl,product,input,locale));}else if(recipient){window.location.href=bookingMailto(recipient,product,input,locale);}else throw Error();setStatus('prepared');}catch{setStatus('error');}}}>
   <label>{ru?'Ваше имя':'Your name'}<input name="name" autoComplete="name" required maxLength={120}/></label>
   <label>{ru?'Желаемая дата':'Preferred date'}<input type="date" name="date" required min={new Date().toISOString().slice(0,10)}/></label>
   <label>{ru?'Взрослые':'Adults'}<input type="number" name="adults" min={1} max={30} defaultValue={2} required/></label>
   <label>{ru?'Дети':'Children'}<input type="number" name="children" min={0} max={20} defaultValue={0} required/></label>
   <label>{ru?'Комментарий':'Message'}<textarea name="message" maxLength={1000} rows={3}/></label>
   <label className="inquiry-consent"><input type="checkbox" name="consent" required/>{ru?'Согласен передать указанные данные для обработки моего запроса.':'I agree to send these details to process my request.'}</label>
   <button type="submit" className="primary-button">{ru?'Подготовить заявку':'Prepare request'}</button>
   <p>{ru?'На сайте заявка не сохраняется, места не резервируются, оплата не взимается.':'The website does not save the request, reserve places or take payment.'}</p>
   {!telegramUrl&&status==='prepared'&&<p role="status">{ru?'Если почта не открылась, напишите на':'If your email app did not open, write to'} <a href={`mailto:${recipient}`}>{recipient}</a>.</p>}
   {status==='error'&&<p role="alert">{ru?'Проверьте дату и количество гостей (не более 30).':'Check the date and group size (maximum 30).'}</p>}
  </form>
  {draft&&<div className="booking-request-draft"><label>{ru?'Текст для отправки в Telegram':'Text to send in Telegram'}<textarea readOnly value={draft.text} rows={10}/></label><button type="button" className="primary-button" onClick={async()=>{try{await navigator.clipboard.writeText(draft.text);setStatus('copied');}catch{setStatus('copy-error');}}}>{ru?'Скопировать заявку':'Copy request'}</button><p><a className="text-link" href={draft.url} target="_blank" rel="noopener noreferrer">{ru?'Открыть Telegram-бот':'Open Telegram bot'}</a></p><p role="status">{status==='copied'?(ru?'Скопировано. Откройте бота, при необходимости нажмите Start, вставьте текст и отправьте.':'Copied. Open the bot, press Start if needed, paste the text and send it.'):(ru?'Скопируйте текст, откройте бота и отправьте сообщение. Подтверждение отправки на сайт не поступает.':'Copy the text, open the bot and send the message. The website does not receive a delivery confirmation.')}</p></div>}
 </section>;
}
