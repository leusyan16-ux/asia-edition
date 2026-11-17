import type { Tour } from "./model";

/** Editorial interpretation of the supplied title, never a supplier itinerary. */
export function editorialSummary(title: Tour["title"], place: Tour["title"]) {
  const name=title.en.toLowerCase();
  const themes:[RegExp,string,string][]=[
    [/lounge/,"Отдых в аэропортовом лаунже: спокойная пауза перед дальнейшим путешествием.","An airport lounge experience for a quieter pause before continuing your journey."],
    [/fast.track|skip.the.line.*airport/,"Услуга ускоренного прохождения аэропортовых формальностей, указанная в названии программы.","An airport fast-track service focused on the procedures identified in the activity title."],
    [/sim.card|esim/,"Мобильная связь в путешествии: SIM-карта или eSIM согласно выбранному продукту.","Mobile connectivity for your trip, with the SIM or eSIM product identified in the title."],
    [/snorkel/,"Снорклинг и знакомство с подводными пейзажами — главный акцент этой активности.","Snorkelling and underwater scenery are the focus of this activity."],
    [/scuba|diving/,"Дайвинг и знакомство с подводным миром выбранного направления.","A diving experience focused on the underwater world of the destination."],
    [/paraglid|skydive/,"Воздушное приключение для тех, кому интересен новый взгляд на пейзажи с высоты.","An aerial adventure for a different perspective on the landscape from above."],
    [/atv|quad/,"Приключение на квадроциклах для любителей активного знакомства с направлением.","An ATV experience for travellers who enjoy exploring a destination actively."],
    [/cooking/,"Знакомство с местной кухней через кулинарную активность, указанную в названии программы.","Discover local food through the cooking activity described in the title."],
    [/food|tasting/,"Гастрономическое знакомство с направлением: внимание к местным вкусам и кулинарной культуре.","A food-focused introduction to the destination and its culinary culture."],
    [/elephant/,"Программа, посвящённая знакомству со слонами. Формат взаимодействия зависит от выбранного предложения.","An elephant-focused experience. The interaction format depends on the selected offering."],
    [/trek|hiking|hike/,"Пешее знакомство с природными пейзажами для тех, кто предпочитает активные маршруты.","Explore natural scenery on foot, with an activity centred on walking or trekking."],
    [/temple/,"Знакомство с храмами и культурным наследием мест, упомянутых в названии программы.","Discover the temples and cultural heritage of the places named in the activity."],
    [/boat|cruise|yacht|sailing/,"Путешествие по воде и знакомство с пейзажами направления с борта судна.","A journey on the water, viewing the destination's scenery from aboard a boat."],
    [/lantern/,"Активность, посвящённая фонарям и атмосфере праздника, указанного в названии программы.","An activity centred on lanterns and the celebration identified in its title."],
    [/transfer|pickup|pick.up/,"Поездка или транспортная услуга между пунктами, указанными в названии предложения.","A journey or transport service between the places identified in the offering's title."],
  ];
  const theme=themes.find(([pattern])=>pattern.test(name));
  return {
    ru: `${place.ru}: ${theme?.[1] ?? `знакомство с направлением через программу «${title.ru}».`}`,
    en: `${place.en}: ${theme?.[2] ?? `discover the destination through the activity “${title.en}”.`}`,
  };
}
