/** Minimize free-text telemetry; never accept contacts or full URLs as a dimension. */
export function safeAnalyticsDetail(value: string) {
  const text=value.trim().slice(0,120);
  if(/@|https?:|www\.|[<>]/i.test(text)) return "";
  // Reject telephone/account-like input even when separators split the digits.
  if((text.match(/\d/g)?.length ?? 0)>=5 && !/^(country|location|category)=[a-z0-9-]+$/.test(text)) return "";
  return text;
}
