export const analyticsEvents = ["visit", "pageview", "catalog", "search", "filter", "product",
  "cart_add", "cart_remove", "checkout", "request_success", "telegram", "register", "login"] as const;
export type AnalyticsEvent = typeof analyticsEvents[number];

export function trackEvent(event: AnalyticsEvent, detail = "") {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent("ae-analytics", { detail: { event, detail } }));
}
