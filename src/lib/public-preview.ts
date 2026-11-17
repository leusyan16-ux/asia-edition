/** First HTTPS release: public presentation, no operational backend. */
export function publicPreviewOnly(
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  return env.PUBLIC_PREVIEW_ONLY === "true";
}
export function previewRoute(
  path: string,
  method: string,
  search: string,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): "next" | "health" | "blocked" {
  if (!publicPreviewOnly(env)) return "next";
  if (path === "/api/health" && method === "GET" && !search) return "health";
  return ["/admin", "/api", "/images/admin"].some(
    (prefix) => path === prefix || path.startsWith(prefix + "/"),
  )
    ? "blocked"
    : "next";
}
