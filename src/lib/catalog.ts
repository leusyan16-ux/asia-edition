import { isAllowedCountry } from "./geography";
export type Locale = 'en' | 'ru';
export type Localized = Record<Locale, string>;
export const defaultLocale: Locale = 'ru';
export const locales: Locale[] = [defaultLocale, 'en'];
export const isLocale = (value: string): value is Locale => locales.includes(value as Locale);
export type Destination = { slug: string; name: Localized; description: Localized };
export type CountryPriority = 'main' | 'high' | 'second';
export const countryGroups: { priority: CountryPriority; label: Localized }[] = [
 { priority: 'main', label: { en: 'Main destinations', ru: 'Основные направления' } },
 { priority: 'high', label: { en: 'High priority', ru: 'Высокий приоритет' } },
 { priority: 'second', label: { en: 'Second phase', ru: 'Вторая очередь' } },
];
export type Country = { priority: CountryPriority; slug: string; name: Localized; mood: Localized; image: string; destinations: Destination[] };
export const allCountries: Country[] = [
  {
    slug: 'singapore', priority: 'high',
    name: { ru: 'Сингапур', en: 'Singapore' },
    mood: { ru: 'Город новых открытий', en: 'A city to discover' },
    image: '/images/singapore.jpg',
    destinations: [{ slug: 'singapore-city', name: { ru: 'Сингапур', en: 'Singapore' }, description: { ru: 'Городские достопримечательности и культурные пространства.', en: 'City landmarks and cultural spaces.' } }],
  },
  {
    "slug": "thailand",
    "name": {
      "en": "Thailand",
      "ru": "Таиланд"
    },
    "mood": {
      "en": "Beyond the familiar shore",
      "ru": "За пределами знакомых берегов"
    },
    "image": "/images/thailand.jpg",
    "destinations": [
      {
        "slug": "chiang-mai",
        "name": {
          "en": "Chiang Mai",
          "ru": "Чиангмай"
        },
        "description": {
          "en": "Explore northern landscapes and the rhythm of an old city.",
          "ru": "Откройте северные пейзажи и ритм старого города."
        }
      }
    ],
    "priority": "main"
  },
  {
    "slug": "vietnam",
    "name": {
      "en": "Vietnam",
      "ru": "Вьетнам"
    },
    "mood": {
      "en": "A thousand shades of green",
      "ru": "Тысяча оттенков зелёного"
    },
    "image": "/images/vietnam.jpg",
    "destinations": [
      {
        "slug": "ha-long-bay",
        "name": {
          "en": "Ha Long Bay",
          "ru": "Бухта Халонг"
        },
        "description": {
          "en": "Limestone islands, quiet waters and a different sense of time.",
          "ru": "Известняковые острова, спокойная вода и другое ощущение времени."
        }
      }
    ],
    "priority": "main"
  },
  {
    "slug": "china",
    "name": {
      "en": "China",
      "ru": "Китай"
    },
    "mood": {
      "en": "An extraordinary sense of scale",
      "ru": "Масштаб, который впечатляет"
    },
    "image": "/images/china.jpg",
    "destinations": [
      {
        "slug": "great-wall",
        "name": {
          "en": "The Great Wall",
          "ru": "Великая Китайская стена"
        },
        "description": {
          "en": "A sample journey through mountain landscapes and monumental history.",
          "ru": "Демонстрационное путешествие среди горных пейзажей и памятников истории."
        }
      }
    ],
    "priority": "main"
  },
  {
    "slug": "turkey",
    "name": {
      "en": "Turkey",
      "ru": "Турция"
    },
    "mood": {
      "en": "Discover the landscapes of Anatolia",
      "ru": "Откройте пейзажи Анатолии"
    },
    "image": "/images/turkey.jpg",
    "destinations": [
      {
        "slug": "cappadocia",
        "name": {
          "en": "Cappadocia",
          "ru": "Каппадокия"
        },
        "description": {
          "en": "Explore the valleys and rock formations of Cappadocia in Asian Turkey.",
          "ru": "Откройте долины и скальные пейзажи Каппадокии в азиатской части Турции."
        }
      }
    ],
    "priority": "main"
  },
  {
    "slug": "united-arab-emirates",
    "name": {
      "en": "United Arab Emirates",
      "ru": "Объединённые Арабские Эмираты"
    },
    "mood": {
      "en": "Where city meets the desert",
      "ru": "Там, где город встречается с пустыней"
    },
    "image": "/images/united-arab-emirates.jpg",
    "destinations": [
      {
        "slug": "dubai",
        "name": {
          "en": "Dubai",
          "ru": "Дубай"
        },
        "description": {
          "en": "A sample introduction to a city between desert landscapes and the Gulf.",
          "ru": "Демонстрационное знакомство с городом между пустыней и заливом."
        }
      }
    ],
    "priority": "main"
  },
  {
    "slug": "indonesia",
    "name": {
      "en": "Indonesia",
      "ru": "Индонезия"
    },
    "mood": {
      "en": "Let the islands lead you",
      "ru": "Навстречу островам"
    },
    "image": "/images/indonesia.jpg",
    "destinations": [
      {
        "slug": "bali",
        "name": {
          "en": "Bali",
          "ru": "Бали"
        },
        "description": {
          "en": "An island encounter with terraces, coastlines and creative culture.",
          "ru": "Знакомство с островом рисовых террас, побережий и творчества."
        }
      }
    ],
    "priority": "high"
  },
  {
    "slug": "sri-lanka",
    "name": {
      "en": "Sri Lanka",
      "ru": "Шри-Ланка"
    },
    "mood": {
      "en": "Take the scenic way",
      "ru": "Выбирайте живописный путь"
    },
    "image": "/images/sri-lanka.jpg",
    "destinations": [
      {
        "slug": "ella",
        "name": {
          "en": "Ella",
          "ru": "Элла"
        },
        "description": {
          "en": "A sample escape into tea country and mountain scenery.",
          "ru": "Демонстрационный маршрут среди чайных плантаций и гор."
        }
      }
    ],
    "priority": "high"
  },
  {
    "slug": "maldives",
    "name": {
      "en": "Maldives",
      "ru": "Мальдивы"
    },
    "mood": {
      "en": "A quieter shade of blue",
      "ru": "Спокойствие в оттенках синего"
    },
    "image": "/images/maldives.jpg",
    "destinations": [
      {
        "slug": "north-male-atoll",
        "name": {
          "en": "North Malé Atoll",
          "ru": "Северный Мале"
        },
        "description": {
          "en": "An illustrative escape among island landscapes and turquoise lagoons.",
          "ru": "Иллюстративное путешествие среди островов и бирюзовых лагун."
        }
      }
    ],
    "priority": "high"
  },
  {
    "slug": "india",
    "name": {
      "en": "India",
      "ru": "Индия"
    },
    "mood": {
      "en": "A journey through living history",
      "ru": "Путешествие сквозь живую историю"
    },
    "image": "/images/india.jpg",
    "destinations": [
      {
        "slug": "agra",
        "name": {
          "en": "Agra",
          "ru": "Агра"
        },
        "description": {
          "en": "Discover architectural heritage and the atmosphere of a historic city.",
          "ru": "Откройте архитектурное наследие и атмосферу исторического города."
        }
      }
    ],
    "priority": "second"
  },
  {
    "slug": "malaysia",
    "name": {
      "en": "Malaysia",
      "ru": "Малайзия"
    },
    "mood": {
      "en": "Many cultures, one journey",
      "ru": "Много культур — одно путешествие"
    },
    "image": "/images/malaysia.jpg",
    "destinations": [
      {
        "slug": "kuala-lumpur",
        "name": {
          "en": "Kuala Lumpur",
          "ru": "Куала-Лумпур"
        },
        "description": {
          "en": "A sample city journey through contemporary architecture and cultural encounters.",
          "ru": "Демонстрационный городской маршрут среди современной архитектуры и культурных открытий."
        }
      }
    ],
    "priority": "second"
  },
  {
    "slug": "philippines",
    "name": {
      "en": "Philippines",
      "ru": "Филиппины"
    },
    "mood": {
      "en": "Follow the island horizon",
      "ru": "Навстречу островному горизонту"
    },
    "image": "/images/philippines.jpg",
    "destinations": [
      {
        "slug": "palawan",
        "name": {
          "en": "Palawan",
          "ru": "Палаван"
        },
        "description": {
          "en": "Imagine an island journey along limestone shores and quiet bays.",
          "ru": "Представьте островное путешествие вдоль скалистых берегов и тихих бухт."
        }
      }
    ],
    "priority": "second"
  },
  {
    "slug": "south-korea",
    "name": {
      "en": "South Korea",
      "ru": "Южная Корея"
    },
    "mood": {
      "en": "Tradition in a new light",
      "ru": "Традиции в новом свете"
    },
    "image": "/images/south-korea.jpg",
    "destinations": [
      {
        "slug": "seoul",
        "name": {
          "en": "Seoul",
          "ru": "Сеул"
        },
        "description": {
          "en": "Explore a sample collection of city scenes, historic spaces and contemporary culture.",
          "ru": "Откройте демонстрационную коллекцию городских пейзажей, исторических мест и современной культуры."
        }
      }
    ],
    "priority": "second"
  },
  {
    "slug": "japan",
    "name": {
      "en": "Japan",
      "ru": "Япония"
    },
    "mood": {
      "en": "Find beauty in the details",
      "ru": "Красота в деталях"
    },
    "image": "/images/japan.jpg",
    "destinations": [
      {
        "slug": "kyoto",
        "name": {
          "en": "Kyoto",
          "ru": "Киото"
        },
        "description": {
          "en": "Temple gardens and intimate streets invite a slower journey.",
          "ru": "Сады храмов и уютные улицы приглашают замедлиться."
        }
      }
    ],
    "priority": "second"
  }
];
// Historical destinations remain available to administrators.
export const countries: Country[] = [
  ...allCountries.filter((c) => isAllowedCountry(c.slug)),
  ...([
    ['brunei', 'Бруней', 'Brunei'], ['cambodia', 'Камбоджа', 'Cambodia'],
    ['laos', 'Лаос', 'Laos'], ['myanmar', 'Мьянма', 'Myanmar'],
    ['timor-leste', 'Тимор-Лешти', 'Timor-Leste'],
  ] as const).map(([slug, ru, en]): Country => ({
    slug, name: { ru, en }, priority: 'second',
    mood: { ru: ({brunei:'Мечети, реки и тропический лес',cambodia:'Храмы и живая история',laos:'Водопады и берега Меконга',myanmar:'Культурное наследие региона','timor-leste':'Побережье и новые горизонты'})[slug], en: ({brunei:'Mosques, rivers and rainforest',cambodia:'Temples and living history',laos:'Waterfalls and the Mekong',myanmar:'A region of cultural heritage','timor-leste':'Coastlines and new horizons'})[slug] },
    image: slug === 'myanmar' ? '/images/southeast-asia.svg' : `/images/${slug}.jpg`, destinations: [],
  })),
];
export const adminCountries: Country[] = [...allCountries, ...countries.filter((c) => !allCountries.some((a) => a.slug === c.slug))];
export const copy = {
 en: { destinations:'Destinations', approach:'Our approach', explore:'Explore Southeast Asia', sample:'Preview collection · sample content', title:'Far from ordinary.\nCloser to Southeast Asia.', intro:'From the islands of Indonesia to the landscapes of Vietnam. Find the places that stay with you.', search:'Where will Southeast Asia take you?', searchLabel:'Country or destination', searchButton:'Find inspiration', collection:'One region.\nEndless possibilities.', collectionText:'Follow your curiosity. Discover our sample collection of countries, each with a world of its own.', all:'Explore all countries', view:'Explore country', story:'Go somewhere.\nFeel something.', storyText:'A thoughtful beginning to your next journey. Explore places through their landscapes, culture and small, unforgettable details.', detail:'Discover the destination', back:'All destinations', empty:'No matches. Try a country or destination name.', results:'Your inspiration', notice:'This is a demonstration catalogue. Tours, prices and availability are not offered. Photography is illustrative.', footer:'Southeast Asia, with a different perspective.', future:'Tour itineraries and booking features will be introduced in a future release.', countryIntro:'A new perspective awaits. Explore this sample destination collection and start imagining your journey.', featured:'Places to begin', language:'Change language', menu:'Open navigation', close:'Close navigation' },
 ru: { destinations:'Направления', approach:'Наш подход', explore:'Открыть Юго-Восточную Азию', sample:'Демо-коллекция · образцы контента', title:'Дальше от привычного.\nБлиже к Юго-Восточной Азии.', intro:'От островов Индонезии до пейзажей Вьетнама. Найдите места, которые останутся с вами.', search:'Куда вас приведёт Юго-Восточная Азия?', searchLabel:'Страна или направление', searchButton:'Найти вдохновение', collection:'Один регион.\nБезграничные открытия.', collectionText:'Следуйте за любопытством. Изучите демо-коллекцию стран, каждая из которых — отдельный мир.', all:'Посмотреть все страны', view:'Открыть страну', story:'Новые места.\nНовые чувства.', storyText:'Вдумчивое начало вашего следующего путешествия. Знакомьтесь с местами через пейзажи, культуру и небольшие незабываемые детали.', detail:'Открыть направление', back:'Все направления', empty:'Ничего не найдено. Попробуйте название страны или направления.', results:'Ваше вдохновение', notice:'Это демонстрационный каталог. Туры, цены и доступность не предлагаются. Фотографии иллюстративные.', footer:'Новый взгляд на Юго-Восточную Азию.', future:'Маршруты туров и бронирование появятся в будущей версии.', countryIntro:'Вас ждёт новый взгляд на путешествия. Изучите демонстрационную коллекцию направлений.', featured:'С чего начать', language:'Сменить язык', menu:'Открыть меню', close:'Закрыть меню' }
};

