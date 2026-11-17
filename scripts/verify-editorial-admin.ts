import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { createIdentity, signSession } from "../src/features/admin/security";

async function main() {
  const directory = path.resolve(".admin-local/pilot-editorial-26");
  const state = JSON.parse(
    await readFile(path.join(directory, "tours.json"), "utf8"),
  );
  const source = JSON.parse(
    await readFile("data/pilots/editorial-26/products.json", "utf8"),
  );
  const tours = state.tours.filter(
    (t: { externalProduct?: { provider: string } }) =>
      t.externalProduct?.provider === "asia_edition_editorial",
  );
  assert.equal(tours.length, 26);
  // Never replace a user's identity. A temporary QA login exists only for this verification.
  const identityFile = path.join(directory, "identity.json");
  const identity = createIdentity(
    "verification@asia-edition.invalid",
    randomBytes(32).toString("hex"),
  );
  await writeFile(identityFile, JSON.stringify(identity), {
    flag: "wx",
    mode: 0o600,
  });
  const url = "http://127.0.0.1:3011";
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3011",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        ADMIN_MODE: "local",
        TOUR_DATA_SOURCE: "local",
        ADMIN_LOCAL_DIRECTORY: ".admin-local/pilot-editorial-26",
        NEXT_DIST_DIR: ".next-admin-qa",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let diagnostic = "";
  child.stdout.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-3000);
  });
  child.stderr.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk).slice(-3000);
  });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null)
        throw new Error("Verification server stopped: " + diagnostic);
      try {
        const r = await fetch(url + "/admin/login");
        if (r.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, "Local development server unavailable: " + diagnostic);
    const cookie = "asia-admin-session=" + signSession(identity);
    const anonymous = await fetch(url + "/admin/tours/" + tours[0].id, {
      redirect: "manual",
    });
    assert.equal(anonymous.status, 307);
    assert.ok(anonymous.headers.get("location")?.includes("/admin/login"));
    const dashboard = await fetch(url + "/admin", { headers: { cookie } });
    assert.equal(dashboard.status, 200);
    let editors = 0,
      previews = 0,
      publicDenied = 0;
    for (const t of tours) {
      const original = source.products.find(
        (p: { external_product_id: string }) =>
          p.external_product_id === t.externalProduct.external_product_id,
      );
      assert.equal(t.status, "draft");
      const r = await fetch(url + "/admin/tours/" + t.id, {
        headers: { cookie },
      });
      assert.equal(r.status, 200, t.slug);
      const html = await r.text();
      assert.ok(
        html.includes(t.externalProduct.external_product_id),
        "Wrong editor source identity",
      );
      assert.ok(html.includes(t.slug), "Wrong editor record");
      assert.ok(html.includes(original.product.title.ru), "Missing RU title");
      assert.ok(html.includes(original.product.title.en), "Missing EN title");
      editors++;
      for (const locale of ["ru", "en"]) {
        const preview = await fetch(
          url + "/admin/tours/" + t.id + "/preview?locale=" + locale,
          { headers: { cookie } },
        );
        assert.equal(
          preview.status,
          200,
          "Admin preview failed: " + t.slug + "/" + locale,
        );
        const content = await preview.text();
        assert.ok(
          content.includes(original.product.title[locale]),
          "Missing localized preview title",
        );
        previews++;
        const publicPage = await fetch(url + "/" + locale + "/tours/" + t.slug);
        assert.equal(publicPage.status, 404, "Draft became public: " + t.slug);
        publicDenied++;
      }
    }
    for (const locale of ["ru", "en"]) {
      const catalog = await fetch(url + "/" + locale + "/tours");
      assert.equal(catalog.status, 200);
      const content = await catalog.text();
      for (const t of tours)
        assert.ok(!content.includes(t.slug), "Draft in catalog");
    }
    const deniedPreview = await fetch(
      url + "/admin/tours/" + tours[0].id + "/preview",
      { redirect: "manual" },
    );
    assert.equal(deniedPreview.status, 307);
    await writeFile(
      path.join(directory, "admin-verification-report.json"),
      JSON.stringify(
        {
          checked_at: new Date().toISOString(),
          server: "development/loopback",
          storage: path.join(directory, "tours.json"),
          editors,
          localized_previews: previews,
          public_detail_404: publicDenied,
          public_catalogs_checked: 2,
          anonymous_editor_denied: true,
          anonymous_preview_denied: true,
          published: 0,
          temporary_identity_removed_on_exit: true,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        editors,
        localized_previews: previews,
        public_detail_404: publicDenied,
        public_catalogs_checked: 2,
        published: 0,
      }),
    );
  } finally {
    if (child.pid && child.exitCode === null) {
      if (process.platform === "win32")
        await new Promise<void>((resolve) => {
          const killer = spawn(
            "taskkill",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.on("close", () => resolve());
        });
      else child.kill("SIGTERM");
    }
    const current = JSON.parse(await readFile(identityFile, "utf8"));
    assert.equal(
      current.secret,
      identity.secret,
      "QA identity changed; do not delete user credentials",
    );
    await unlink(identityFile);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
