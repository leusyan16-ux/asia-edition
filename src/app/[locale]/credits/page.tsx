import { notFound } from "next/navigation";
import { isLocale } from "@/lib/catalog";

export default async function Credits({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ru = locale === "ru";
  return <article className="commerce-shell">
    <h1>{ru ? "Авторские права на фотографии" : "Photography attribution"}</h1>
    <p>{ru
      ? "Фотографии используются с разрешения правообладателей или на условиях соответствующих лицензий."
      : "Photographs are used with permission from the rights holders or under their applicable licences."}</p>
    <h2>{ru ? "Сигирия, Шри-Ланка" : "Sigiriya, Sri Lanka"}</h2>
    <p>“Landscape view of Sigiriya Fortress” — WKMI96. <a href="https://commons.wikimedia.org/wiki/File:Landscape_view_of_Sigiriya_Fortress.jpg" rel="noopener noreferrer">Wikimedia Commons</a>. <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license">CC BY-SA 4.0</a>.</p>
    <p>{ru
      ? "Изображение уменьшено и кадрировано. Адаптированная версия распространяется на условиях CC BY-SA 4.0."
      : "The image has been resized and cropped. The adapted version is available under CC BY-SA 4.0."}</p>
  </article>;
}
