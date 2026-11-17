import path from "node:path";
import { isLoopback } from "../admin/security";
export function postgresSelected(env: NodeJS.ProcessEnv = process.env) {
  return env.TOUR_DATA_SOURCE === "postgres";
}
export function assertLocalPostgres(
  host: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (
    !postgresSelected(env) ||
    env.NODE_ENV !== "development" ||
    env.ADMIN_MODE !== "local" ||
    !isLoopback(host)
  )
    throw new Error(
      "PostgreSQL preview requires development, localhost and ADMIN_MODE=local",
    );
}
export function postgresDirectory(
  profile = process.env.POSTGRES_LOCAL_PROFILE ?? "development",
) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile))
    throw new Error("Invalid PostgreSQL profile");
  return path.resolve(".admin-postgres", profile);
}
