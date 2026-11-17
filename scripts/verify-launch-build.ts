/** Local production artifact smoke only. No database or external services. */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { countries } from "../src/lib/catalog";
async function main() {
  const origin = "http://127.0.0.1:3014";
  const preview = process.env.PUBLIC_PREVIEW_ONLY === "true";
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3014",
    ],
    {
      env: {
        ...process.env,
        NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || "qa/launch-release-build",
        ADMIN_MODE: "disabled",
        TOUR_DATA_SOURCE: process.env.TOUR_DATA_SOURCE || "demo",
        POSTGRES_RUNTIME: "embedded",
        POSTGRES_REMOTE_ENABLED: "false",
        INQUIRIES_ENABLED: "false",
        SITE_INDEXING_ENABLED: "false",
        SITE_URL: origin,
      },
      windowsHide: true,
      stdio: "ignore",
    },
  );
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        if ((await fetch(origin + "/api/health")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    assert(ready);
    const paths = [
      "/ru",
      "/en",
      "/ru/tours",
      "/en/tours",
      ...countries.flatMap((c) => [
        `/ru/countries/${c.slug}`,
        `/en/countries/${c.slug}`,
      ]),
      ...(preview
        ? [
            ...(process.env.TOUR_DATA_SOURCE === "static" ? [] : ["/ru/tours/demo-ha-long", "/en/tours/demo-ha-long"]),
            "/ru/tours?country=japan",
            ...countries.flatMap((c) =>
              c.destinations.flatMap((d) => [
                `/ru/countries/${c.slug}/${d.slug}`,
                `/en/countries/${c.slug}/${d.slug}`,
              ]),
            ),
          ]
        : []),
    ];
    for (const path of paths) {
      const r = await fetch(origin + path);
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    }
    assert.equal(
      (await fetch(origin + "/api/health?check=ready")).status,
      preview ? 404 : 503,
    );
    assert.equal(
      (await fetch(origin + "/api/inquiries")).status,
      preview ? 404 : 503,
    );
    assert.equal(
      (await fetch(origin + "/admin/api/postgres")).status,
      preview ? 404 : 403,
    );
    assert.equal(
      (
        await fetch(origin + "/admin/api/images", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: "{}",
        })
      ).status,
      preview ? 404 : 403,
    );
    if (preview) {
      assert.equal(new URL((await fetch(origin)).url).pathname, "/ru");
      for (const path of [
        "/admin",
        "/admin/login",
        "/admin/import",
        "/api/test",
        "/images/admin/00000000-0000-4000-8000-000000000001.webp",
      ])
        assert.equal((await fetch(origin + path)).status, 404, path);
      assert.equal(
        (await fetch(origin + "/ru/tours/test-nonexistent-product")).status,
        404,
      );
      for (const c of countries)
        assert.equal((await fetch(origin + c.image)).status, 200, c.image);
      assert.equal(
        (
          await fetch(
            origin +
              "/_next/image?url=%2Fimages%2Fadmin%2F00000000-0000-4000-8000-000000000001.webp&w=640&q=75",
          )
        ).status,
        400,
      );
    }
    const robots = await (await fetch(origin + "/robots.txt")).text();
    assert(robots.includes("Disallow: /"));
    const xml = await (await fetch(origin + "/sitemap.xml")).text();
    assert(!xml.includes("/tours/"));
    await mkdir("data/benchmarks/launch", { recursive: true });
    await writeFile(
      "data/benchmarks/launch/production-artifact-smoke.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          scope: preview
            ? "localhost production-build artifact in public-preview-only mode; not a cloud deployment"
            : "localhost production-build artifact in demo mode; not production services",
          paths_tested: paths.length,
          all_status_200: true,
          security_headers: true,
          ...(preview
            ? {
                operational_routes_hidden_404: true,
                private_image_optimizer_rejected: true,
              }
            : {
                disabled_inquiries_503: true,
                unconfigured_database_readiness_503: true,
              }),
          admin_anonymous_denied: true,
          admin_photo_rights_anonymous_denied: true,
          indexing_disabled: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      "Local production artifact smoke passed: " +
        paths.length +
        " public routes",
    );
  } finally {
    if (server.pid)
      await new Promise((r) =>
        spawn("taskkill", ["/PID", String(server.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("close", r),
      );
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
