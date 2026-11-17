import { publicPreviewOnly } from "./public-preview";
export function publicOrigin(env: Partial<NodeJS.ProcessEnv> = process.env) {
  if (!env.SITE_URL) return null;
  try {
    const u = new URL(env.SITE_URL);
    if (
      u.protocol !== "https:" ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      u.username ||
      u.password
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}
export function indexingEnabled(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return (
    !publicPreviewOnly(env) &&
    env.SITE_INDEXING_ENABLED === "true" &&
    env.NODE_ENV === "production" &&
    !!publicOrigin(env) &&
    env.TOUR_DATA_SOURCE === "postgres" &&
    env.POSTGRES_RUNTIME === "native" &&
    env.POSTGRES_REMOTE_ENABLED === "true"
  );
}
export function localizedAlternates(path: string, locale: string) {
  return {
    canonical: `/${locale}${path}`,
    languages: { ru: `/ru${path}`, en: `/en${path}` },
  };
}
