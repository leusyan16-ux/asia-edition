import { z } from "zod";
const names: Record<string, string> = {
  title: "Название",
  summary: "Краткое описание",
  description: "Описание",
  country: "Страна",
  location: "Направление",
  city: "Город",
  resort: "Курорт",
  category: "Категория",
  slug: "Адрес",
  prices: "Цены",
  slots: "Даты",
  departures: "Расписание",
  images: "Фотографии",
  status: "Публикация",
  timezone: "Часовой пояс",
  itinerary: "Программа",
  pickupLocations: "Места забора",
  meetingPoints: "Места встречи",
  durationMinutes: "Длительность",
  verifiedAt: "Дата проверки",
  operator: "Оператор",
};
export function validationError(error: unknown): string {
  if (!(error instanceof z.ZodError))
    return error instanceof Error
      ? error.message
      : "Не удалось проверить данные";
  return error.issues
    .map((issue) => {
      const [first, ...rest] = issue.path;
      const field = names[String(first)] || String(first || "Данные");
      const path = rest
        .map((p) =>
          typeof p === "number" ? `строка ${p + 1}` : String(p).toUpperCase(),
        )
        .join(" / ");
      const message =
        issue.code === "custom"
          ? issue.message
          : issue.code === "invalid_value"
            ? "Выберите допустимое значение"
            : issue.code === "too_big"
              ? "Превышено допустимое значение"
              : issue.code === "too_small"
                ? "Значение ниже допустимого"
                : issue.code === "invalid_format"
                  ? "Некорректный формат"
                  : "Проверьте формат и заполнение";
      return `${field}${path ? ` (${path})` : ""}: ${message}`;
    })
    .join("\n");
}
