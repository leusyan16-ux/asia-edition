import { createHash } from "node:crypto";
import { z } from "zod";
import { parseCSV } from "./csv";
import type { ExternalImportRecord } from "./import-engine";
import type { ProductFeedAdapter } from "./klook-adapter";
import { geographyError } from "@/lib/geography";
import type {
  TranslationTask,
  TranslationProposal,
} from "./offline-translations";

export const gygRowSchema = z
  .object({
    source: z.literal("GetYourGuide"),
    source_product_id: z
      .union([z.string(), z.number().int().positive()])
      .transform(String)
      .pipe(z.string().regex(/^[1-9]\d*$/)),
    source_url: z.string().url(),
    title_uk: z.string().min(1).max(2000),
    image_url_reference: z.string().default(""),
    display_price_text: z.string().default(""),
    rating_text: z.string().default(""),
    duration_and_features_text: z.string().default(""),
    country: z.string().default(""),
    city: z.string().default(""),
    description_uk: z.string().default(""),
    cancellation_policy: z.string().default(""),
    availability: z.string().default(""),
    rights_status: z.string().default("unverified"),
    publication_status: z.string().default("needs_review"),
    source_files: z.string().default(""),
  })
  .strict();
export type GygRow = z.infer<typeof gygRowSchema>;

// Provider location IDs/names present in the supplied URL inventory. This is a
// draft mapping, not verification of every stop of an operator's full itinerary.
const thaiPlaces = new Set(
  `mae-sai phi-phi-islands bangkok phuket khao-lak ko-samui krabi chiang-mai surat-thani-province southern-thailand-and-andaman-coast krabi-province wichit phuket-city ao-nang mueang-phuket-district kamala surat-thani-city karon racha-noi-island chiang-rai khlong-sok ban-phe ayutthaya kathu-phuket patong ko-samet muang-krabi takua-pa ko-chang pattaya pileh-lagoon pa-klok ko-nang-yuan thailand ko-panyi mu-ko-ang-thong-national-park phanom bang-phli-district nathon-town udon-thani mueang-phang-nga-district kanchanaburi khao-sok-surat-thani koh-rok-islands khao-yai ko-lipe ko-lanta lampi-waterfall ko-tao chiang-mai-province hong-island-360deg-view-point`.split(
    " ",
  ),
);
const vietnamPlaces = new Set(`hanoi sa-pa dong-giang-heaven-s-gate ho-chi-minh-city ha-long da-nang huong-hoa ha-giang cat-ba-island hue-vietnam dalat dong-hoi pu-luong hoi-an nha-trang fishing-village-binh-thuan quang-binh-province phan-thiet ninh-binh qui-nhon mai-chau phu-quoc dong-van vung-tau cao-bang thanh-hoa can-tho mui-ne lan-ha-bay phong-nha thanh-ha-pottery-village viet-hai-village hai-phong bien-hoa vinh cai-beo-floating-village son-la-province cao-bang-city vung-vieng hai-phong-municipality con-dao sa-dec pac-bo buon-ma-thuot bac-trung phu-quoc-island cat-ba-archipelago northern-vietnam cat-tien lang-co-duong-lam`.split(" "));
const bruneiPlaces = new Set(["brunei", "brunei-muara-district", "bandar-seri-begawan", "sengkurong"]);
const laosPlaces = new Set("luang-prabang pak-beng nong-khiaw vang-vieng vientiane pakse phonsavan tad-mok-waterfall-laos pak-lay nam-ngum-reservoir luang-prabang-province laos don-det-laos ban-xang-hai ban-chan-pottery-village".split(" "));
const cambodiaPlaces = new Set(["sihanoukville-province", "phnom-penh", "siem-reap", "kampong-thom", "battambang", "kep", "kampot", "kampong-phluk", "kratie", "sihanoukville", "kampot-province"]);
const singaporePlaces = new Set(["singapore","bishan-singapore","pulau-ubin"]);
const indonesiaPlaces = new Set(`bintan-island batam-city batam-island tanjung-pinang gili-islands labuan-bajo malang gili-trawangan lombok yogyakarta bali bandung ubud jakarta south-batur sanur surabaya senaru probolinggo uluwatu canggu bukit-lawang benoa mount-batur kuta manado karangasem-regency indonesia padang-indonesia padangbai lombok-wildlife-park makassar pangkalan-bun denpasar lovina west-java gunung-kawi-temple pecatu sangeh lumajang-city-indonesia nuca-molas karimunjawa belitung banyuwangi nusa-penida banjar-kelod tetebatu sukarara-weaving-village tegalalang tegallalang pasuruan sidemen-village batoemadeg kerobokan pura-mengening kintamani jimbaran selong-belanak gili-meno sukawati kusamba medan mount-rinjani-national-park prambanan-indonesia ijen gianyar abiansemal lembongan tabanan tulamben mataram nusa-lembongan kampung-toyapakeh berastagi cemorolawang`.split(' '));
const malaysiaPlaces = new Set(`johor-bahru masai kuala-lumpur kuala-selangor malacca-city kuah batu-caves ipoh langkawi george-town-malaysia langkawi-archipelago bilit-kinabatangan kuching semporna sepang terengganu brinchang teluk-bahang kota-kinabalu langkawi-wildlife-park lahad-datu gamuda-cove penang perak kinabatangan-sabah bukit-tinggi kuantan genting-highlands sabah balik-pulau tawau putrajaya mantanani-islands rawang lata-berkoh sandakan kinarut bongawan pahang malacca-state tanah-rata kundasang shah-alam boh-tea-plantation kea-farm kedah selangor kota-tinggi cameron-highlands port-dickson kuala-tahan banting santubong sarawak seri-kembangan manukan-island penang-island ranau malaysia johor agro-market perai southwest-penang-island-district tenom`.split(' '));
const philippinesPlaces = new Set(`boracay el-nido manila tagbilaran-city moalboal badian coron bohol general-luna-surigao-del-norte cebu cebu-city panglao iloilo-city puerto-princesa palawan davao-city tagaytay lapu-lapu-city balabac sibaltan tacloban-city biliran subic oslob makati man-made-forest surigao-del-norte port-barton loboc sebaring dumaguete cambugahay-falls malay cavite philippines cortes-bohol boracay-island-malay baguio linapacan tarsier-sanctuary culion-island sohoton-cove anda-phillippines boracay-newcoast siargao-island banaue calatagan calabarzon mactan candijay`.split(' '));
const cityPlaces = new Set(
  "dili mae-sai bandar-seri-begawan sengkurong nong-khiaw vang-vieng vientiane pakse phonsavan pak-lay bangkok phuket-city krabi chiang-mai chiang-rai surat-thani-city pattaya udon-thani kanchanaburi luang-prabang pak-beng hanoi ho-chi-minh-city da-nang hue-vietnam dalat dong-hoi hoi-an nha-trang phan-thiet qui-nhon vung-tau can-tho hai-phong bien-hoa vinh cao-bang-city sa-dec buon-ma-thuot phnom-penh singapore batam-city tanjung-pinang johor-bahru labuan-bajo malang yogyakarta bandung ubud jakarta surabaya probolinggo manado makassar pangkalan-bun denpasar lumajang-city-indonesia banyuwangi pasuruan medan mataram kuala-lumpur kuala-selangor malacca-city kuah ipoh george-town-malaysia kuching kota-kinabalu lahad-datu kuantan tawau putrajaya rawang sandakan shah-alam kota-tinggi banting tenom manila tagbilaran-city cebu-city iloilo-city puerto-princesa davao-city tagaytay lapu-lapu-city tacloban-city makati dumaguete baguio siem-reap kampong-thom battambang kep kampot kratie sihanoukville".split(
    " ",
  ),
);
const ruNames: Record<string, string> = {
  'siem-reap':'Сиемреап','kampong-thom':'Кампонгтхом',battambang:'Баттамбанг',kep:'Кеп',kampot:'Кампот','kampong-phluk':'Кампонг-Пхлук',kratie:'Кратьэх',sihanoukville:'Сиануквиль','kampot-province':'Провинция Кампот',
  boracay:'Боракай','el-nido':'Эль-Нидо',manila:'Манила',bohol:'Бохоль',cebu:'Себу','cebu-city':'Себу-Сити',coron:'Корон',palawan:'Палаван','puerto-princesa':'Пуэрто-Принсеса',panglao:'Панглао',moalboal:'Моалбоал',oslob:'Ослоб','siargao-island':'Сиаргао',philippines:'Филиппины','davao-city':'Давао',baguio:'Багио',makati:'Макати',malay:'Малай (Аклан)',
  'kuala-lumpur':'Куала-Лумпур','kuala-selangor':'Куала-Селангор','malacca-city':'Малакка',langkawi:'Лангкави',penang:'Пенанг','george-town-malaysia':'Джорджтаун',ipoh:'Ипох',kuching:'Кучинг','kota-kinabalu':'Кота-Кинабалу','genting-highlands':'Гентинг-Хайлендз',semporna:'Семпорна',sandakan:'Сандакан',malaysia:'Малайзия','batu-caves':'Пещеры Бату',
  bali:'Бали',ubud:'Убуд',jakarta:'Джакарта',yogyakarta:'Джокьякарта',lombok:'Ломбок', 'labuan-bajo':'Лабуан-Баджо',malang:'Маланг',bandung:'Бандунг',surabaya:'Сурабая',denpasar:'Денпасар', 'gili-islands':'Острова Гили','nusa-penida':'Нуса-Пенида','gili-trawangan':'Гили-Траванган','nusa-lembongan':'Нуса-Лембонган',indonesia:'Индонезия',medan:'Медан',mataram:'Матарам',uluwatu:'Улувату',canggu:'Чангу',kuta:'Кута',sanur:'Санур',jimbaran:'Джимбаран',kintamani:'Кинтамани',
  singapore:"Сингапур", "bishan-singapore":"Бишан", "pulau-ubin":"Пулау-Убин",
  "bintan-island":"Бинтан", "batam-city":"Батам", "batam-island":"Батам", "tanjung-pinang":"Танджунгпинанг", "johor-bahru":"Джохор-Бару", masai:"Масай",
  hanoi: "Ханой",
  "ho-chi-minh-city": "Хошимин",
  "da-nang": "Дананг",
  "hue-vietnam": "Хюэ",
  "hoi-an": "Хойан",
  "nha-trang": "Нячанг",
  "phu-quoc": "Фукуок",
  "phnom-penh": "Пномпень",
  bangkok: "Бангкок",
  phuket: "Пхукет",
  "phuket-city": "Пхукет",
  krabi: "Краби",
  "chiang-mai": "Чиангмай",
  "chiang-rai": "Чианграй",
  "khao-lak": "Као-Лак",
  "ko-samui": "Самуи",
  "phi-phi-islands": "Острова Пхи-Пхи",
  "ao-nang": "Ао-Нанг",
  pattaya: "Паттайя",
  ayutthaya: "Аюттхая",
  "luang-prabang": "Луангпхабанг",
  "pak-beng": "Пакбенг",
    dili: "Дили",
    "mae-sai": "Маєсай",
    "bandar-seri-begawan": "Бандар-Сери-Бегаван", sengkurong: "Сенгкуронг", brunei: "Бруней", "brunei-muara-district": "Бруней-Муара",
    "nong-khiaw": "Нонг-Кхьяу", "vang-vieng": "Вангвьенг", vientiane: "Вьентьян", pakse: "Паксе", phonsavan: "Пхонсаван", "pak-lay": "Паклай",
  "ko-lanta": "Ко-Ланта",
  "ko-lipe": "Ко-Липе",
  "ko-chang": "Ко-Чанг",
  "ko-samet": "Ко-Самет",
  "khao-yai": "Кхао-Яй",
  thailand: "Таиланд",
};
const readable = (s: string) =>
  s.replaceAll("-", " ").replace(/^./, (c) => c.toUpperCase());
export function parseGygInput(
  content: string,
  format: "csv" | "json",
): unknown[] {
  if (Buffer.byteLength(content) > 8 * 1024 * 1024)
    throw Error("Provider input exceeds 8 MiB");
  if (format === "json") {
    const j = JSON.parse(content.replace(/^\uFEFF/, ""));
    const rows = Array.isArray(j) ? j : (j.products ?? j.excursions ?? j.tours);
    if (!Array.isArray(rows) || rows.length > 5000 || !rows.length)
      throw Error("Expected 1–5000 provider rows");
    return rows;
  }
  const rows = parseCSV(content, 5000, 8 * 1024 * 1024),
    header = rows.shift();
  if (!header || new Set(header).size !== header.length)
    throw Error("Invalid CSV headers");
  return rows.map((row) => {
    if (row.length !== header.length) throw Error("CSV column count mismatch");
    return Object.fromEntries(header.map((k, i) => [k, row[i]]));
  });
}
export function gygIdentity(row: GygRow) {
  const u = new URL(row.source_url);
  if (
    u.protocol !== "https:" ||
    !["www.getyourguide.com", "getyourguide.com"].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash
  )
    throw Error("Invalid GetYourGuide source URL");
  const match = u.pathname.match(
    /^\/([a-z0-9_-]+)-l(\d+)\/([a-z0-9_-]+)-t(\d+)\/?$/i,
  );
  if (!match || match[4] !== row.source_product_id)
    throw Error("Source product ID/URL mismatch");
  return {
    place: match[1].toLowerCase(),
    locationId: match[2],
    englishTitle: readable(match[3].replaceAll("_", "-")),
  };
}
export function gygTitleTask(row: GygRow): TranslationTask {
  const text = gygIdentity(row).englishTitle;
  return {
    key: `getyourguide:${row.source_product_id}:title:ru`,
    productId: row.source_product_id,
    field: "title",
    from: "en",
    to: "ru",
    text,
    sourceHash: createHash("sha256")
      .update(JSON.stringify(["en", "ru", text]))
      .digest("hex"),
  };
}
export function parseGygDuration(raw: string) {
  const range = /\d\s*(?:-|–|до)\s*\d/u.test(raw);
  // Only a single explicit leading duration. Never turn a range/day tour into a guessed mean.
  const m =
    /^\s*(\d+(?:[.,]\d+)?)\s*(годин(?:а|и|у)?|хвилин(?:а|и|у)?|hours?|minutes?)(?:\s*(?:•|$))/iu.exec(
      raw,
    );
  return !range && m
    ? Math.round(
        Number(m[1].replace(",", ".")) * (/год|hour/i.test(m[2]) ? 60 : 1),
      ) || null
    : null;
}
function category(text: string) {
  if (/transfer|трансфер|airport.*arrival|аеропорт.*прибут/iu.test(text))
    return "transfers";
  if (/ticket|admission|квиток|вхідний/iu.test(text)) return "tickets";
  if (/show|cabaret|шоу|кабаре/iu.test(text)) return "shows";
  if (/boat|cruise|snork|dive|diving|катер|човн|круїз|плаван|дайв/iu.test(text))
    return "sea";
  if (/rafting|atv|zipline|quad|рафтинг|квадроцикл/iu.test(text))
    return "adventure";
  if (/temple|history|cooking|храм|кулінар|істор/iu.test(text))
    return "culture";
  if (/elephant|hike|jungle|wildlife|слон|похід|джунгл/iu.test(text))
    return "nature";
  return "tours";
}

export class GetYourGuideAdapter implements ProductFeedAdapter {
  readonly provider = "getyourguide";
  constructor(
    private proposals: TranslationProposal[] = [],
    private syncedAt = new Date().toISOString(),
  ) {}
  prepare(payload: unknown[]) {
    const records: ExternalImportRecord[] = [],
      excluded: { row: number; id: string | null; reason: string }[] = [],
      seen = new Set<string>();
    for (const [index, value] of payload.entries())
      try {
        const row = gygRowSchema.parse(value),
          identity = gygIdentity(row),
          task = gygTitleTask(row);
        if (seen.has(row.source_product_id))
          throw Error("Duplicate provider + product ID");
        seen.add(row.source_product_id);
        const rawText =
          row.title_uk +
          " " +
          row.duration_and_features_text +
          " " +
          row.source_url;
        if (
          /delhi|taj-mahal|jaipur|ranthambore|д[еє]л[іи]|тадж|джайпур|рантхамбор|russia|росі[яїює]|росси|москв|moscow|владивосток/iu.test(
            rawText,
          )
        )
          throw Error(
            "Outside Southeast Asia or excluded route in supplied title/URL",
          );
        if(malaysiaPlaces.has(identity.place) && /singapore-(?:private-tour|nighttime-city)/i.test(row.source_url)) throw Error("Conflicting title/activity URL and source location: review required");
        if(/salt-making/.test(row.source_url) && /лемпуянг|тірта-ганга/iu.test(row.title_uk)) throw Error("Title describes a temple itinerary but activity URL describes salt making; review required");
        const destination=["chiang-rai","chiang-mai"].includes(identity.place) && /(?:to-luang-prabang|to-loas-luangprabang|chiang-rai-luang-prabang-train-transfer)/i.test(row.source_url) ? {place:"luang-prabang",locationId:"397"} : identity.place==='singapore' && /from-singapore-batam/i.test(row.source_url) ? {place:'batam-city',locationId:'240283'} : identity.place==='singapore' && /from-singapore-johor-bahru/i.test(row.source_url) ? {place:'johor-bahru',locationId:'420'} : identity.place==='bangkok' && /from-bangkok-2-day-siem-reap-tour-with-angkor-wat/i.test(row.source_url) ? {place:'siem-reap',locationId:'274'} : identity.place==='ho-chi-minh-city' && /from-ho-chi-minh-city-siem-reap-angkor-temples/i.test(row.source_url) ? {place:'siem-reap',locationId:'274'} : identity.place==='ho-chi-minh-city' && /from-ho-chi-minh-2-day-mekong-delta-to-phnom-penh-by-boat/i.test(row.source_url) ? {place:'phnom-penh',locationId:'273'} : identity;
        const country = singaporePlaces.has(destination.place) ? 'singapore' : indonesiaPlaces.has(destination.place) ? 'indonesia' : malaysiaPlaces.has(destination.place) ? 'malaysia' : philippinesPlaces.has(destination.place) ? 'philippines' : thaiPlaces.has(destination.place)
          ? "thailand"
          : vietnamPlaces.has(destination.place)
            ? "vietnam"
          : cambodiaPlaces.has(destination.place)
            ? "cambodia"
          : destination.place === "dili" ? "timor-leste" : bruneiPlaces.has(destination.place) ? "brunei" : laosPlaces.has(destination.place)
            ? "laos"
            : null;
        if (!country)
          throw Error(
            "Geography cannot be established from supplied place/URL",
          );
        const geo = geographyError({ country, description: { ru: rawText } });
        if (geo) throw Error(geo);
        const proposal = this.proposals.filter(
          (p) => p.key === task.key && p.sourceHash === task.sourceHash,
        );
        const translated =
          proposal.length === 1 &&
          proposal[0].targetText.trim() &&
          !/<[^>]*>/.test(proposal[0].targetText) &&
          JSON.stringify(task.text.match(/\d+/g) ?? []) ===
            JSON.stringify(proposal[0].targetText.match(/\d+/g) ?? [])
            ? proposal[0].targetText.trim()
            : null;
        // A source-English fallback remains labelled as untranslated in private metadata.
        const title = { ru: translated ?? task.text, en: task.text };
        const description = {
          ru: [
            `Программа «${title.ru}». Подробный маршрут и условия требуют подтверждения.`,
          ],
          en: [
            `${title.en}. The detailed itinerary and conditions require confirmation.`,
          ],
        };
        const slug = `gyg-l${destination.locationId}`,
          name = {
            ru: ruNames[destination.place] ?? readable(destination.place),
            en: readable(destination.place),
          };
        const kind = cityPlaces.has(destination.place)
          ? ("city" as const)
          : ("destination" as const);
        const c = category(rawText),
          price = /^\s*(\d+(?:[.,]\d+)?)\s+([A-Z]{3})\s*$/.exec(
            row.display_price_text.replaceAll("\u00a0", " "),
          );
        const rating = /^([0-5](?:[.,]\d+)?)$/.exec(row.rating_text.trim());
        const durationMinutes = parseGygDuration(
          row.duration_and_features_text,
        );
        const photo = row.image_url_reference
          ? new URL(row.image_url_reference)
          : null;
        if (
          photo &&
          (photo.protocol !== "https:" ||
            photo.hostname !== "cdn.getyourguide.com" ||
            photo.username ||
            photo.password ||
            photo.port)
        )
          throw Error("Invalid image source reference");
        records.push({
          provider: this.provider,
          external_product_id: row.source_product_id,
          source_url: row.source_url,
          import_status: "needs_review",
          last_synced_at: this.syncedAt,
          test_data: false,
          product_type:
            c === "transfers"
              ? "transfer"
              : c === "tickets"
                ? "ticket"
                : "excursion",
          packages: [],
          locations: [{ slug, country, name, kind, parent: null }],
          source_metadata: {
            original: row,
            original_locale: "uk",
            translation: {
              english: "source-url-slug editorial draft",
              russian: translated
                ? "local MT draft, needs review"
                : "English fallback, RU translation missing",
            },
            geography: {
              source_country: row.country,
              source_place: identity.place,
              external_location_id: identity.locationId,
              country_basis:
                "title/URL place mapping; not a verified full route",
              route_verified: false,
            },
            price_observation: {
              raw: row.display_price_text,
              amount: price ? Number(price[1].replace(",", ".")) : null,
              currency: price?.[2] ?? null,
              verified: false,
              basis: null,
              valid_until: null,
            },
            rating_observation: {
              raw: row.rating_text,
              value: rating ? Number(rating[1].replace(",", ".")) : null,
              verified: false,
            },
            image_references: row.image_url_reference
              ? [row.image_url_reference]
              : [],
            duration_observation: {
              raw: row.duration_and_features_text,
              minutes: durationMinutes,
            },
            category_basis: "editorial title/URL classification, needs review",
          },
          product: {
            slug: `getyourguide-${row.source_product_id}`,
            country,
            routeCountries: destination!==identity ? [['bangkok','chiang-rai','chiang-mai'].includes(identity.place)?'thailand':identity.place==='ho-chi-minh-city'?'vietnam':'singapore',country] : [],
            location: slug,
            city: kind === "city" ? slug : null,
            category: c,
            title,
            summary: { ru: description.ru[0], en: description.en[0] },
            description,
            images: [],
            prices: [],
            availability: [],
            durationMinutes,
            schedule: null,
            seo: {
              title,
              description: { ru: description.ru[0], en: description.en[0] },
            },
          },
        });
      } catch (e) {
        excluded.push({
          row: index + 1,
          id:
            typeof value === "object" && value
              ? String(
                  (value as { source_product_id?: unknown })
                    .source_product_id ?? "",
                ) || null
              : null,
          reason: e instanceof Error ? e.message : "Invalid row",
        });
      }
    return { records, excluded };
  }
  async normalize(payload: unknown) {
    if (!Array.isArray(payload)) throw Error("Expected provider rows array");
    const result = this.prepare(payload);
    if (result.excluded.length)
      throw Error("Provider rows require review; use prepare() report");
    return result.records;
  }
}
