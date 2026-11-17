import { categories } from "@/features/tours/labels";
export const localCategories = [
  ...categories,
  { slug: "tickets", name: { ru: "Билеты", en: "Tickets" } },
  { slug: "shows", name: { ru: "Шоу", en: "Shows" } },
  { slug: "entertainment", name: { ru: "Развлечения", en: "Entertainment" } },
  { slug: "parks", name: { ru: "Парки", en: "Parks" } },
  { slug: "museums", name: { ru: "Музеи", en: "Museums" } },
  { slug: "transfers", name: { ru: "Трансферы", en: "Transfers" } },
  { slug: "tours", name: { ru: "Туры", en: "Tours" } },
];
