export type CatalogRole =
  "asia_catalog_reader" | "asia_catalog_editor" | "asia_catalog_worker";
export function nativeSelected(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return (
    env.TOUR_DATA_SOURCE === "postgres" && env.POSTGRES_RUNTIME === "native"
  );
}
/** Explicit remote opt-in; no network access occurs during configuration validation. */
export function nativeSettings(
  role: CatalogRole,
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  if (
    !nativeSelected(env) ||
    env.POSTGRES_REMOTE_ENABLED !== "true" ||
    env.ADMIN_MODE !== "supabase"
  )
    throw new Error(
      "Native PostgreSQL requires explicit approval and Supabase administrator authentication",
    );
  const name = {
    asia_catalog_reader: "CATALOG_READER_DATABASE_URL",
    asia_catalog_editor: "CATALOG_EDITOR_DATABASE_URL",
    asia_catalog_worker: "CATALOG_WORKER_DATABASE_URL",
  }[role];
  const connectionString = env[name];
  if (!connectionString)
    throw new Error("Missing server database configuration");
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Invalid server database configuration");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password ||
    !env.POSTGRES_APPROVED_HOST ||
    url.hostname !== env.POSTGRES_APPROVED_HOST
  )
    throw new Error("Database host or URL configuration rejected");
  const max = Number(env.POSTGRES_POOL_MAX ?? 4);
  if (!Number.isInteger(max) || max < 1 || max > 20)
    throw new Error("Pool max must be 1..20");
  return {
    connectionString,
    max,
    ssl: {
      rejectUnauthorized: true as const,
      ...(env.POSTGRES_CA_PEM ? { ca: env.POSTGRES_CA_PEM } : {}),
    },
  };
}
