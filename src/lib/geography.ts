/** UN M49 South-eastern Asia. Historical records remain valid in storage. */
export const southeastAsianCountries = [
  "brunei", "cambodia", "indonesia", "laos", "malaysia", "myanmar",
  "philippines", "singapore", "thailand", "timor-leste", "vietnam",
] as const;
export const isAllowedCountry = (country: unknown): boolean =>
  typeof country === "string" &&
  (southeastAsianCountries as readonly string[]).includes(country);

// Match destination names, not the language label "Russian". Conservative holds
// require editorial review; text matching cannot prove an undisclosed itinerary.
const excludedRoute = /(?:^|[^\p{L}])(?:russia|russian federation|росси[\p{L}]*|рф|москов[\p{L}]*|moscow|saint petersburg|st\.? petersburg|санкт[- ]петербург[\p{L}]*|владивосток[\p{L}]*|vladivostok|сочи|sochi|калининград[\p{L}]*|kaliningrad|japan|япони[\p{L}]*|south korea|южн[\p{L}]* коре[\p{L}]*|china|китай[\p{L}]*|кита[яюеї][\p{L}]*|turkey|türkiye|турци[\p{L}]*|united arab emirates|оаэ|sri lanka|шри[- ]ланк[\p{L}]*|maldives|мальдив[\p{L}]*|india|инди[яюи])(?:$|[^\p{L}])/iu;
const routeFields = ["title", "summary", "description", "highlights", "itinerary",
  "meeting", "pickup", "meetingPoints", "pickupLocations", "transportation",
  "location", "city", "resort", "route", "routeCountries", "locations"];

export function geographyError(value: unknown): string | null {
  if (!value || typeof value !== "object") return "Geography is missing";
  const record = value as Record<string, unknown>;
  if (!isAllowedCountry(record.country))
    return "Destination is outside Southeast Asia";
  if (Array.isArray(record.routeCountries) &&
      record.routeCountries.some((c) => !isAllowedCountry(c)))
    return "Route includes a country outside Southeast Asia";
  if (Array.isArray(record.locations) && record.locations.some((l) =>
    !l || typeof l !== "object" || !isAllowedCountry(l.country)))
    return "Route location is outside Southeast Asia";
  let text = routeFields.map((key) => JSON.stringify(record[key] ?? "")).join(" ");
  // Singapore neighbourhoods are not journeys to India or China. Keep standalone
  // country names and all explicit routeCountries checks intact.
  if(['singapore','malaysia'].includes(String(record.country))) text=text
    .replace(/little[- ]india|мал[\p{L}]*[- ]+(?:інді[\p{L}]*|инди[\p{L}]*)/giu,'neighbourhood')
    .replace(/china[- ]?town|чайна[- ]таун[\p{L}]*|китай[\p{L}]*\s+(?:квартал|город)[\p{L}]*/giu,'neighbourhood');
  if (excludedRoute.test(text))
    return "Route mentions an excluded destination; geography review required";
  return null;
}

export function isAllowedTour(value: unknown): boolean {
  if (geographyError(value)) return false;
  const record = value as Record<string, unknown>;
  const source = record.externalProduct as { facts?: unknown; locations?: unknown[]; commercial?: {packages?: unknown[]} } | null;
  if (!source) return true;
  if (source.facts && geographyError(source.facts)) return false;
  if (source.locations?.some((l) => !l || typeof l !== "object" || !isAllowedCountry((l as {country?: unknown}).country))) return false;
  return !source.commercial?.packages?.some((p) => geographyError({ ...(p as object), country: record.country }));
}
