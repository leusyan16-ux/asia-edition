export type AnalyticsChoice = "yes" | "no";
export const consentKey = "ae-analytics-consent";
export const consentLifetime = 180 * 86400;
type ConsentStorage = Pick<Storage,"getItem"|"setItem">;

export function storedConsent(storage: ConsentStorage, now = Date.now()): AnalyticsChoice | null {
  const raw=storage.getItem(consentKey);
  if(raw==="yes"||raw==="no") return raw; // Existing preferences are retained.
  try {
    const record=JSON.parse(raw ?? "null");
    return record?.version===1 && ["yes","no"].includes(record.choice) &&
      typeof record.expiresAt==="number" && record.expiresAt>now && record.expiresAt<=now+consentLifetime*1000
      ? record.choice : null;
  } catch { return null; }
}
export function saveConsent(storage: ConsentStorage,choice: AnalyticsChoice,now=Date.now()) {
  storage.setItem(consentKey,JSON.stringify({version:1,choice,expiresAt:now+consentLifetime*1000}));
}
export function cookieConsent(cookie: string): AnalyticsChoice | null {
  return /(?:^|;\s*)ae-analytics=(yes|no)(?:;|$)/.exec(cookie)?.[1] as AnalyticsChoice | undefined ?? null;
}
