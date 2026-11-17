import type { Tour } from "./model";

type Text = { ru: string; en: string };
export const visitorGuidanceProfiles = [
  {
    id: "gardens-by-the-bay",
    country: "singapore",
    match: /gardens by the bay|сады у залива|сады у затоки/i,
    source:
      "https://www.gardensbythebay.com.sg/en/plan-your-visit/visiting-guidelines.html",
    publisher: "Gardens by the Bay",
    tips: [
      {
        ru: "В Flower Dome и Cloud Forest нельзя употреблять еду и напитки. Это правило оранжерей, а не всех открытых садов.",
        en: "Eating and drinking are not permitted inside Flower Dome and Cloud Forest. This rule concerns the conservatories, rather than all outdoor gardens.",
      },
      {
        ru: "Не срывайте растения и не забирайтесь на деревья. Для прогулки с детской коляской используйте лифты вместо эскалаторов.",
        en: "Do not pick plants or climb trees. When visiting with a stroller, use lifts instead of escalators.",
      },
      {
        ru: "Перед посещением проверьте официальный календарь работы выбранных оранжерей и достопримечательностей: доступ в них определяется вашим билетом.",
        en: "Before visiting, check the official opening and closure calendar for your chosen conservatories and attractions. Admission depends on your ticket.",
      },
    ] satisfies Text[],
  },
  {
    id: "langkawi-weather",
    country: "malaysia",
    match: /langkawi|лангкави|лангкаві/i,
    source: "https://www.met.gov.my/en/forecast/weather/district/Ds001/",
    publisher: "METMalaysia",
    tips: [
      {
        ru: "Перед выездом посмотрите актуальный прогноз для Лангкави на сайте METMalaysia. Прогноз обновляется; погода на дату вашей поездки здесь не фиксируется.",
        en: "Before setting out, check the current Langkawi forecast on METMalaysia. Forecasts change; this page does not predict conditions on your travel date.",
      },
      {
        ru: "Для морской прогулки отдельно уточните у организатора решение о выходе, точку посадки и действия при изменении погоды. Районный прогноз не подтверждает безопасность конкретного рейса.",
        en: "For a boat trip, ask the organiser to confirm departure, boarding location and arrangements if conditions change. A district forecast does not confirm the safety of a particular sailing.",
      },
    ] satisfies Text[],
  },
  {
    id: "skycab",
    country: "malaysia",
    match: /skycab|sky cab|канатн.{0,16}лангкави|лангкави.{0,30}канатн/i,
    source: "https://langkawiskycab.my/en/help/on-the-day/weather-and-closures",
    publisher: "Panorama Langkawi / SkyCab",
    tips: [
      {
        ru: "Работа канатной дороги зависит от погоды и технических условий. Проверьте режим работы перед поездкой и уточните доступность выбранного варианта.",
        en: "Cable car operation depends on weather and technical conditions. Check operating information before travelling and confirm your chosen option is available.",
      },
      {
        ru: "Оператор отдельно описывает перенос или обмен билетов при остановке работы. Не считайте это автоматическим возвратом: условия вашего пакета нужно согласовать с продавцом.",
        en: "The operator describes rescheduling or exchange arrangements when the ride cannot run. Do not assume an automatic refund; confirm the terms of your package with the seller.",
      },
    ] satisfies Text[],
  },
] as const;

export function visitorGuidance(
  tour: Pick<Tour, "country" | "title" | "category">,
) {
  const title = `${tour.title.ru} ${tour.title.en}`;
  return visitorGuidanceProfiles
    .filter((p) => p.country === tour.country && p.match.test(title))
    .map((p) => ({
      ...p,
      checkedAt: "2026-10-30",
      tips:
        p.id === "langkawi-weather" && tour.category !== "sea"
          ? p.tips.slice(0, 1)
          : p.tips,
    }));
}
