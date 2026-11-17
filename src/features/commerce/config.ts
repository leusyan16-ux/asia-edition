export function commerceStagingErrors(env: Partial<NodeJS.ProcessEnv>) {
  const errors: string[] = [];
  let project: URL | undefined;
  let site: URL | undefined;
  try {
    project = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  } catch {}
  try {
    site = new URL(env.SITE_URL ?? "");
  } catch {}
  const ref = env.COMMERCE_STAGING_PROJECT_REF;
  if (!ref || !/^[a-z0-9]{20}$/.test(ref) || ref === "xvzrgnrzbesqwsribpdm")
    errors.push("COMMERCE_STAGING_PROJECT_REF");
  if (
    !project ||
    project.origin !== `https://${ref}.supabase.co` ||
    project.pathname !== "/" ||
    project.search ||
    project.hash ||
    project.username ||
    project.password
  )
    errors.push("NEXT_PUBLIC_SUPABASE_URL");
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let publicKey = Boolean(key?.startsWith("sb_publishable_"));
  if (key && !publicKey) {
    try {
      publicKey =
        JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
          .role === "anon";
    } catch {}
  }
  if (!publicKey) errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (
    !site ||
    site.protocol !== "https:" ||
    ["asia-edition.vercel.app", "localhost", "127.0.0.1"].includes(
      site.hostname,
    ) ||
    site.pathname !== "/" ||
    site.search ||
    site.hash ||
    site.username ||
    site.password
  )
    errors.push("SITE_URL");
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "preview") errors.push("VERCEL_ENV");
  if (env.TOUR_DATA_SOURCE !== "static") errors.push("TOUR_DATA_SOURCE");
  if (env.ADMIN_MODE !== "disabled") errors.push("ADMIN_MODE");
  if (env.POSTGRES_REMOTE_ENABLED !== "false")
    errors.push("POSTGRES_REMOTE_ENABLED");
  if (env.COMMERCE_GOOGLE_ENABLED !== "false")
    errors.push("COMMERCE_GOOGLE_ENABLED");
  return errors;
}

export function commerceEnabled(env: Partial<NodeJS.ProcessEnv> = process.env) {
  return (
    env.COMMERCE_ENABLED === "true" &&
    env.PUBLIC_PREVIEW_ONLY !== "true" &&
    (env.COMMERCE_ENVIRONMENT !== "staging" ||
      commerceStagingErrors(env).length === 0)
  );
}
