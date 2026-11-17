import { notFound } from "next/navigation";
import Link from "next/link";
import { isLocale } from "@/lib/catalog";
import { managerContact } from "@/features/commerce/contact";
export default async function Privacy({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ru = locale === "ru";
  const sections = [
    ["Данные для работы сервиса", "Data needed to provide the service",
      "Вход, подтверждение адреса, сохранение корзины и избранного, обработка заявок и защита от злоупотреблений работают независимо от согласия на дополнительную статистику. Они используют необходимые данные сессии и сохранения в браузере. После входа корзина и избранное синхронизируются с аккаунтом. Выбор конфиденциальности также сохраняется в браузере.",
      "Sign-in, email verification, cart and favorites storage, request processing and abuse prevention work independently of consent to optional statistics. They use necessary session data and browser storage. After sign-in, your cart and favorites sync with your account. Your privacy choice is also stored in your browser."],
    ["Заявки и операционные показатели", "Requests and operational figures",
      "Контакты, выбранные экскурсии, даты, участники и пожелания сохраняются для обработки заявки. Менеджер получает уведомление через Telegram. Сайт не принимает онлайн-оплату и не считает заявку подтверждённым бронированием. Администратор видит суммарные регистрации, количество заявок и их статусы по рабочим данным, независимо от выбора дополнительной статистики.",
      "Your contact details, selected activities, dates, guests and preferences are stored to process your request. The manager receives a Telegram notification. The website does not take online payments or treat a request as a confirmed booking. The administrator sees registration totals, request counts and statuses from operational records, independently of your optional statistics choice."],
    ["Техническая работа и безопасность", "Technical operation and security",
      "Технические журналы хостинга и серверов используются для доступности, безопасности и устранения ошибок. Хостинг обрабатывает сетевые сведения, необходимые для доставки запросов и защиты сайта. Эти журналы не включают посетителя в поведенческую воронку Dashboard и не используются как обход отказа от статистики.",
      "Hosting and server logs support availability, security and troubleshooting. Hosting processes network information needed to deliver requests and protect the website. These logs do not add a visitor to the Dashboard's behavioural funnel and are not used to bypass a statistics refusal."],
    ["Дополнительная статистика по согласию", "Optional statistics with your consent",
      "Только после нажатия «Разрешить» собираются посещения, просмотры страниц и экскурсий, поисковые запросы и фильтры, действия с корзиной, начало оформления и отправка заявки, переходы в чат, тип устройства, сайт-источник и приблизительные страна и город. География определяется по сетевому соединению без GPS. Цель — улучшение сайта и подбора экскурсий, а не рекламное профилирование.",
      "Only after you select Allow do we collect visits, page and activity views, search terms and filters, cart activity, the start and submission of requests, chat clicks, device type, referring website and approximate country and city. Location is inferred from the network without GPS. These statistics improve the website and activity selection, not advertising profiles."],
    ["Минимизация и хранение", "Minimisation and retention",
      "Таблицы статистики не содержат полных IP-адресов, точных координат, паролей или содержимого контактных форм. Сетевые сведения кратковременно используются сервером для расчёта ежедневного псевдонимного идентификатора, не связанного с ID аккаунта. Источник перехода сохраняется только как имя сайта. Поиск ограничен по длине; распознаваемые email, телефоны и URL отфильтровываются. Не вводите персональные данные в поиск. В Dashboard показываются агрегаты. Ежедневный сетевой идентификатор не равен уникальному человеку. Записи старше 35 дней очищаются при следующей записи события.",
      "Analytics tables do not contain full IP addresses, precise coordinates, passwords or contact-form contents. Network information is used transiently by the server to calculate a daily pseudonymous identifier, not linked to your account ID. Referrals contain only a website hostname. Search terms are length-limited; recognisable email addresses, phone numbers and URLs are filtered. Please do not enter personal information into search. The Dashboard displays aggregates. A daily network identifier is not a unique person. Records older than 35 days are removed when the next event is recorded."],
    ["Ваш выбор", "Your choice",
      "«Отклонить» отключает дополнительное отслеживание. Каталог, вход, корзина и заявки остаются доступны, без перенаправления на главную. Продолжение просмотра не считается согласием. Выбор хранится до 180 дней. Изменить его можно кнопкой «Настройки конфиденциальности» внизу страницы. После отзыва новые необязательные события не отправляются; ранее учтённые агрегаты не переписываются.",
      "Decline disables optional tracking. The catalogue, sign-in, cart and requests remain available, without redirecting to the homepage. Continued browsing is not consent. Your choice is stored for up to 180 days. Change it using Privacy preferences at the bottom of the page. After withdrawal, new optional events are not sent; previously recorded aggregates are not rewritten."],
  ];
  return <article className="commerce-shell privacy-policy">
    <h1>{ru ? "Политика конфиденциальности" : "Privacy Policy"}</h1>
    <p>{ru ? "Обновлено 11 ноября 2026 года." : "Updated 11 November 2026."}</p>
    {sections.map(([titleRu,titleEn,textRu,textEn])=><section key={titleEn}><h2>{ru?titleRu:titleEn}</h2><p>{ru?textRu:textEn}</p></section>)}
    <h2>{ru ? "Доступ и обращения" : "Access and enquiries"}</h2>
    <p>{ru
      ? "Доступ к рабочим данным ограничен полномочиями сотрудников, к Dashboard — административной ролью и MFA. В кабинете доступны экспорт данных и запрос удаления. Срок хранения заявок, технических журналов и вопросы о персональных данных уточняйте у менеджера: "
      : "Operational data is restricted by staff permissions; the Dashboard requires an administrative role and MFA. Your account offers data export and a deletion request. Ask the manager about request and technical-log retention or personal-data enquiries: "}<a href={managerContact} rel="noopener noreferrer">@VN_instal</a>.</p>
    <p><Link href={`/${locale}/credits`}>{ru ? "Авторские права на фотографии" : "Photography attribution"}</Link></p>
  </article>;
}
