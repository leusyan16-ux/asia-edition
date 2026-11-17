import { Search, ArrowRight } from "lucide-react";
import { type Locale } from "@/lib/catalog";
export function TravelSearch({ locale }: { locale: Locale }) {
  const ru = locale === "ru";
  return (
    <div className="search-wrap">
      <form className="search-form" action={`/${locale}/tours`} method="get">
        <Search size={22} aria-hidden="true" />
        <div className="search-field">
          <label htmlFor="travel-query">
            {ru
              ? "Каким будет ваше следующее открытие?"
              : "What will you discover next?"}
          </label>
          <input
            id="travel-query"
            name="search"
            placeholder={
              ru
                ? "Название экскурсии, место или впечатление"
                : "Activity, place or experience"
            }
            type="search"
            maxLength={100}
          />
        </div>
        <button className="primary-button" type="submit">
          {ru ? "Найти экскурсию" : "Find an activity"}
          <ArrowRight size={18} />
        </button>
      </form>
    </div>
  );
}
