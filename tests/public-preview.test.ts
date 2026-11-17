import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { publicPreviewOnly, previewRoute } from "../src/lib/public-preview";
import { indexingEnabled } from "../src/lib/site-config";

test("first public deployment: closed operations, safe health and unchanged default development", () => {
  const env = { PUBLIC_PREVIEW_ONLY: "true" };
  assert.equal(publicPreviewOnly({}), false);
  for (const path of [
    "/admin",
    "/admin/login",
    "/admin/api/session",
    "/admin/api/import",
    "/api/inquiries",
    "/api/test",
    "/images/admin/TEST.webp",
  ])
    for (const method of ["GET", "POST", "PATCH", "DELETE", "HEAD", "OPTIONS"])
      assert.equal(previewRoute(path, method, "", env), "blocked");
  for (const path of [
    "/ru",
    "/en",
    "/ru/tours",
    "/en/countries/japan/kyoto",
    "/images/japan.jpg",
    "/_next/image",
  ])
    assert.equal(previewRoute(path, "GET", "", env), "next");
  assert.equal(previewRoute("/api/health", "GET", "", env), "health");
  assert.equal(
    previewRoute("/api/health", "GET", "?check=ready", env),
    "blocked",
  );
  assert.equal(previewRoute("/api/health", "POST", "", env), "blocked");
  assert.equal(previewRoute("/admin", "GET", "", {}), "next");
  assert.equal(
    indexingEnabled({
      ...env,
      NODE_ENV: "production",
      SITE_URL: "https://example.invalid",
      SITE_INDEXING_ENABLED: "true",
      TOUR_DATA_SOURCE: "postgres",
      POSTGRES_RUNTIME: "native",
      POSTGRES_REMOTE_ENABLED: "true",
    }),
    false,
  );
});

test("Vercel first-release manifest: matching build/runtime safety flags, pinned install and private upload exclusions", async () => {
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  assert.deepEqual(config.env, config.build.env);
  assert.equal(config.framework, "nextjs");
  assert.match(
    config.installCommand,
    /pnpm@10\.34\.8 install --frozen-lockfile/,
  );
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert(
    config.installCommand.includes(`${manifest.packageManager} install`),
    "package manager must match the actual deployment command",
  );
  assert.equal(config.env.PUBLIC_PREVIEW_ONLY, "true");
  assert.equal(config.env.ADMIN_MODE, "disabled");
  assert.equal(config.env.TOUR_DATA_SOURCE, "static");
  for (const key of [
    "POSTGRES_REMOTE_ENABLED",
    "PRIVATE_STORAGE_ENABLED",
    "INQUIRIES_ENABLED",
    "SITE_INDEXING_ENABLED",
  ])
    assert.equal(config.env[key], "false");
  assert(
    !Object.keys(config.env).some((key) =>
      /KEY|SECRET|TOKEN|DATABASE_URL/.test(key),
    ),
  );
  const ignored = await readFile(".vercelignore", "utf8");
  for (const entry of [
    ".env*",
    ".admin-local/",
    ".admin-postgres/",
    "qa/",
    "data/",
  ])
    assert(ignored.split(/\r?\n/).includes(entry));
});
