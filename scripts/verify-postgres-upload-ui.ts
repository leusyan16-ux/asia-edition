/** Isolated localhost browser test. Next is the sole owner of its PGlite profile. */
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import sharp from "sharp";
import { createIdentity } from "../src/features/admin/security";
import { syntheticProducts, syntheticCSV } from "./fixtures/stage10-products";
async function main() {
  const launchQA = process.env.LAUNCH_QA === "true";
  const name = "test-stage10-http-" + randomUUID(),
    admindir = path.resolve(".admin-local", name),
    pgdir = path.resolve(".admin-postgres", name),
    dist = path.resolve("qa", name + "-next");
  const pilot = ".admin-local/pilot-editorial-26/tours.json",
    hash = async () =>
      createHash("sha256")
        .update(await readFile(pilot))
        .digest("hex"),
    before = await hash(),
    previousNextEnv = await readFile("next-env.d.ts", "utf8");
  const origin = "http://127.0.0.1:3013",
    email = "qa@example.invalid",
    password = "TEST-" + randomUUID();
  let server: ReturnType<typeof spawn> | undefined,
    output = "";
  const load = createRequire(path.join(process.cwd(), "package.json"));
  const { chromium } = load(
    "C:/Users/ya14l/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
  );
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    await mkdir(admindir, { recursive: true });
    await writeFile(
      path.join(admindir, "identity.json"),
      JSON.stringify(createIdentity(email, password)),
      { flag: "wx", mode: 0o600 },
    );
    server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        "3013",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_ENV: "development",
          ADMIN_MODE: "local",
          TOUR_DATA_SOURCE: "postgres",
          POSTGRES_LOCAL_PROFILE: name,
          POSTGRES_LOCAL_WORKER: "off",
          ADMIN_LOCAL_DIRECTORY: ".admin-local/" + name,
          NEXT_DIST_DIR: path.relative(process.cwd(), dist),
          POSTGRES_RUNTIME: "embedded",
          INQUIRIES_ENABLED: launchQA ? "true" : "false",
          INQUIRY_SIGNING_KEY: launchQA
            ? "TEST-" + randomUUID() + randomUUID()
            : "",
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const capture = (b: Buffer) => {
      output = (output + b.toString()).slice(-8000);
    };
    server.stdout?.on("data", capture);
    server.stderr?.on("data", capture);
    let ready = false;
    for (let i = 0; i < 90; i++) {
      try {
        if ((await fetch(origin + "/admin/login")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    assert(ready, "Local server failed to start");
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      }),
      page = await context.newPage();
    page.setDefaultTimeout(45000);
    const pageErrors: string[] = [];
    const consoleWarnings: string[] = [];
    page.on("console", (message: { type(): string; text(): string }) => {
      if (["error", "warning"].includes(message.type()))
        consoleWarnings.push(message.text().slice(0, 3000));
    });
    page.on("pageerror", (e: Error) => pageErrors.push(e.message));
    assert.equal(
      (await fetch(origin + "/admin/api/postgres-import")).status,
      403,
    );
    await page.goto(origin + "/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL("**/admin");
    await page.goto(origin + "/admin/import");
    const bad = syntheticProducts(1);
    bad[0].product.title.ru = "";
    await page.locator(".pg-upload input[type=file]").setInputFiles({
      name: "TEST-invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bad)),
    });
    await page
      .getByRole("button", { name: "Проверить файл", exact: true })
      .click();
    await page.locator(".pg-upload-errors").waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Сохранить / продолжить", exact: true })
        .count(),
      0,
    );
    const products = syntheticProducts(101);
    const file = {
      name: "TEST-101.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(products)),
    };
    await page.locator(".pg-upload input[type=file]").setInputFiles(file);
    await page
      .getByRole("button", { name: "Проверить файл", exact: true })
      .click();
    await page
      .getByText("Проверка завершена. Импорт ещё не запущен", { exact: true })
      .waitFor();
    let gateResolve!: () => void, unblock!: () => void;
    const reached = new Promise<void>((r) => (gateResolve = r)),
      gate = new Promise<void>((r) => (unblock = r));
    await page.route(
      "**/admin/api/postgres-import",
      async (route: {
        request(): {
          method(): string;
          headers(): Record<string, string>;
          postDataJSON(): { action?: string; cursor?: number };
        };
        continue(): Promise<void>;
      }) => {
        const request = route.request();
        if (
          request.method() === "POST" &&
          request.headers()["content-type"]?.includes("application/json")
        ) {
          const body = request.postDataJSON();
          if (body.action === "step" && body.cursor === 1) {
            gateResolve();
            await gate;
          }
        }
        await route.continue();
      },
    );
    await page
      .getByRole("button", { name: "Сохранить / продолжить", exact: true })
      .click();
    await Promise.race([
      reached,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Checkpoint gate timeout")), 45000),
      ),
    ]);
    await page
      .getByRole("button", { name: "Пауза отправки пакетов", exact: true })
      .click();
    unblock();
    await page
      .getByText(
        "Отправка пакетов приостановлена; контрольная точка сохранена",
        { exact: true },
      )
      .waitFor();
    await page.unroute("**/admin/api/postgres-import");
    await page.reload();
    await page
      .getByRole("button", { name: "Открыть задание", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "Сохранить / продолжить", exact: true })
      .click();
    await page
      .getByText("Импорт завершён. Все записи остаются черновиками", {
        exact: true,
      })
      .waitFor();
    await page.goto(origin + "/admin?search=" + encodeURIComponent("ТЕСТ 0"));
    await page.getByRole("link").filter({ hasText: "ТЕСТ 0" }).first().click();
    await page.waitForURL("**/admin/tours/*");
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    await page
      .getByRole("textbox", { name: "Название · RU", exact: true })
      .fill("ТЕСТ РЕДАКЦИЯ 0");
    const png = await sharp({
      create: { width: 32, height: 20, channels: 3, background: "#285a46" },
    })
      .png()
      .toBuffer();
    await page.locator(".admin-upload input[type=file]").setInputFiles({
      name: "TEST-own-generated-image.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.locator(".admin-gallery img").first().waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector(
        ".admin-gallery img",
      ) as HTMLImageElement | null;
      return !!img?.complete && img.naturalWidth > 0;
    });
    const imagePath = await page
      .locator(".admin-gallery img")
      .first()
      .getAttribute("src");
    const key = imagePath!.split("/").at(-1)!;
    assert.equal((await fetch(origin + "/images/admin/" + key)).status, 404);
    assert.equal(
      (await fetch(origin + "/admin/api/images/" + key)).status,
      404,
    );
    await page
      .getByRole("button", { name: "Сохранить проверку", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Сначала сохраните" })
      .waitFor();
    const saved = page.waitForResponse(
      (r: { url(): string; request(): { method(): string } }) =>
        r.url().endsWith("/admin/api/tours") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Сохранить экскурсию", exact: true })
      .click();
    assert.equal((await saved).status(), 200);
    await page.reload();
    await page
      .getByLabel("Редакционный статус", { exact: true })
      .selectOption("approved");
    await page
      .getByLabel("Права на контент", { exact: true })
      .selectOption("licensed");
    await page
      .getByLabel("Документ о правах (HTTPS)", { exact: true })
      .fill("https://example.invalid/TEST-own-rights");
    const review = page.waitForResponse((r: { url(): string }) =>
      r.url().endsWith("/admin/api/postgres"),
    );
    await page
      .getByRole("button", { name: "Сохранить проверку", exact: true })
      .click();
    assert.equal((await review).status(), 200);
    await page.reload();
    assert.equal(
      await page.getByLabel("Права на контент", { exact: true }).inputValue(),
      "licensed",
    );
    for (const locale of ["ru", "en"]) {
      const r = await context.request.get(
        `${origin}/admin/tours/${id}/preview?locale=${locale}`,
      );
      assert.equal(r.status(), 200);
      assert((await r.text()).includes("/admin/api/images/" + key));
      assert.equal(
        (await fetch(`${origin}/${locale}/tours/test-stage10-0`)).status,
        404,
      );
    }
    await page.goto(origin + "/admin/import");
    await page.locator(".pg-upload input[type=file]").setInputFiles({
      name: "TEST-repeat.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        syntheticCSV(syntheticProducts(101, "2026-10-20T00:00:00Z")),
      ),
    });
    await page
      .getByRole("button", { name: "Проверить файл", exact: true })
      .click();
    await page
      .getByText("Проверка завершена. Импорт ещё не запущен", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Сохранить / продолжить", exact: true })
      .click();
    await page
      .getByText("Импорт завершён. Все записи остаются черновиками", {
        exact: true,
      })
      .waitFor();
    await page.goto(origin + "/admin/tours/" + id);
    assert.equal(
      await page
        .getByRole("textbox", { name: "Название · RU", exact: true })
        .inputValue(),
      "ТЕСТ РЕДАКЦИЯ 0",
    );
    assert.equal(await page.locator(".admin-gallery img").count(), 1);
    assert.equal(
      await page.getByLabel("Права на контент", { exact: true }).inputValue(),
      "licensed",
    );
    if (launchQA) {
      await page.goto(origin + "/admin/operators");
      await page
        .getByLabel("Название оператора", { exact: true })
        .fill("TEST ONLY VERIFIED OPERATOR");
      await page
        .getByLabel("Ссылка на документ проверки (HTTPS)", { exact: true })
        .fill("https://example.invalid/TEST-only-operator");
      await page
        .getByLabel("Я проверил оператора и подтверждающие документы", {
          exact: true,
        })
        .check();
      await page
        .getByRole("button", {
          name: "Сохранить проверенного оператора",
          exact: true,
        })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "Оператор сохранён" })
        .waitFor();
      await page.goto(origin + "/admin/tours/" + id);
      await page
        .locator("details")
        .evaluateAll((nodes: HTMLDetailsElement[]) =>
          nodes.forEach((n) => (n.open = true)),
        );
      await page
        .getByLabel("Подробное описание · RU", { exact: true })
        .fill("ТЕСТ — синтетическая активность только для локальной проверки.");
      await page
        .getByLabel("Подробное описание · EN", { exact: true })
        .fill(
          "TEST — synthetic activity only for isolated local verification.",
        );
      await page
        .getByLabel("Длительность, минуты", { exact: true })
        .first()
        .fill("60");
      await page
        .getByLabel("Оператор", { exact: true })
        .selectOption({ label: "TEST ONLY VERIFIED OPERATOR · Проверен" });
      await page
        .getByLabel("Дата проверки экскурсии", { exact: true })
        .fill("2026-10-22T10:00");
      await page
        .getByLabel("Демонстрационные данные (не попадают в реальный каталог)")
        .uncheck();
      const saving = page.waitForResponse(
        (r: { url(): string; request(): { method(): string } }) =>
          r.url().endsWith("/admin/api/tours") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Сохранить экскурсию", exact: true })
        .click();
      assert.equal((await saving).status(), 200);
      await page.reload();
      const reviewing = page.waitForResponse((r: { url(): string }) =>
        r.url().endsWith("/admin/api/postgres"),
      );
      await page
        .getByRole("button", { name: "Сохранить проверку", exact: true })
        .click();
      assert.equal((await reviewing).status(), 200);
      await page.reload();
      assert.equal(
        (await fetch(`${origin}/ru/tours/test-stage10-0`)).status,
        404,
      );
      await page
        .getByText("Отдельное разрешение на публикацию", { exact: true })
        .click();
      await page
        .getByLabel("Введите ПУБЛИКОВАТЬ для подтверждения", { exact: true })
        .fill("ПУБЛИКОВАТЬ");
      const publishing = page.waitForResponse((r: { url(): string }) =>
        r.url().endsWith("/admin/api/postgres"),
      );
      await page
        .getByRole("button", {
          name: "Разрешить и опубликовать эту версию",
          exact: true,
        })
        .click();
      assert.equal((await publishing).status(), 200);
      await mkdir("qa/launch", { recursive: true });
      for (const locale of ["ru", "en"]) {
        await page.goto(`${origin}/${locale}/tours/test-stage10-0`);
        await page.locator(".inquiry-section").waitFor();
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 });
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          );
          await page.screenshot({
            path: `qa/launch/product-${locale}-${width}.png`,
            fullPage: true,
          });
        }
        assert.equal(
          (await fetch(`${origin}/${locale}/tours?search=test-stage10`)).status,
          200,
        );
      }
      const form = page.locator(".inquiry-section");
      await form.getByLabel("Name", { exact: true }).fill("TEST CONTACT");
      await form
        .getByLabel("Email", { exact: true })
        .fill("test-launch@example.invalid");
      await form
        .getByLabel("Your question", { exact: true })
        .fill("TEST CONTACT REQUEST ONLY");
      await form.getByRole("checkbox").check();
      await page.waitForTimeout(2200);
      await form
        .getByRole("button", { name: "Send request", exact: true })
        .click();
      await form
        .getByRole("status")
        .filter({ hasText: "Request saved" })
        .waitFor();
      await page.goto(origin + "/admin/inquiries");
      await page
        .getByText("test-launch@example.invalid", { exact: false })
        .waitFor();
      assert.equal((await fetch(origin + "/images/admin/" + key)).status, 200);
      const optimizer = await fetch(
        `${origin}/_next/image?url=${encodeURIComponent("/images/admin/" + key)}&w=640&q=75`,
      );
      assert.equal(optimizer.status, 400);
      await mkdir("data/benchmarks/launch", { recursive: true });
      await writeFile(
        "data/benchmarks/launch/browser-cycle.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            local_only: true,
            synthetic_only: true,
            import_edit_photo_review_explicit_publish: true,
            public_ru_en: true,
            desktop_mobile: true,
            inquiry_persisted_in_admin: true,
            private_image_optimizer_denied: true,
            pilot_sha256: before,
          },
          null,
          2,
        ) + "\n",
      );
      await page.goto(origin + "/admin/tours/" + id);
    }
    await mkdir("qa/stage10", { recursive: true });
    await page.screenshot({
      path: "qa/stage10/editor-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "qa/stage10/editor-mobile.png",
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.goto(origin + "/admin/import");
    await page.getByText("TEST-repeat.csv", { exact: false }).first().waitFor();
    await page.screenshot({
      path: "qa/stage10/import-mobile.png",
      fullPage: true,
    });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "qa/stage10/import-desktop.png",
      fullPage: true,
    });
    const receipts = await (
      await context.request.get(origin + "/admin/api/postgres-import")
    ).json();
    assert.equal(receipts.uploads.length, 2);
    const logs = await (
      await context.request.get(origin + "/admin/api/postgres")
    ).json();
    assert.equal(logs.jobs.length, 2);
    assert(logs.jobs.every((j: { state: string }) => j.state === "completed"));
    const forbidden = await context.request.post(
      origin + "/admin/api/postgres-import",
      {
        headers: { Origin: "https://example.invalid" },
        data: { action: "release", id: logs.jobs[0].id },
      },
    );
    assert([400, 403].includes(forbidden.status()));
    assert.equal(await hash(), before);
    assert.deepEqual(pageErrors, []);
    await mkdir("data/benchmarks/stage10", { recursive: true });
    if (!launchQA)
      await writeFile(
        "data/benchmarks/stage10/browser-cycle.json",
        JSON.stringify(
          {
            at: new Date().toISOString(),
            localhost: true,
            json_and_csv: true,
            resume_after_reload: true,
            synthetic_products: 101,
            duplicate_free: true,
            photo_preserved: true,
            editorial_preserved: true,
            review_preserved: true,
            private_image_and_preview: true,
            imported_public_404: true,
            anonymous_denied: true,
            csrf_denied: true,
            desktop_mobile_overflow: false,
            console_warnings: consoleWarnings,
            pilot_sha256: before,
            screenshots: [
              "qa/stage10/import-desktop.png",
              "qa/stage10/import-mobile.png",
              "qa/stage10/editor-desktop.png",
              "qa/stage10/editor-mobile.png",
            ],
          },
          null,
          2,
        ) + "\n",
      );
    console.log("Stage 10 browser cycle: passed");
    await context.close();
  } catch (error) {
    console.error(output.slice(-6000));
    throw error;
  } finally {
    await browser.close();
    if (server?.pid)
      await new Promise((r) =>
        spawn("taskkill", ["/PID", String(server!.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        }).on("close", r),
      );
    for (const [directory, root] of [
      [admindir, ".admin-local"],
      [pgdir, ".admin-postgres"],
      [dist, "qa"],
    ]) {
      assert(directory.startsWith(path.resolve(root) + path.sep));
      assert(path.basename(directory).startsWith("test-stage10-http-"));
      await rm(directory, { recursive: true, force: true });
    }
    const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8"));
    tsconfig.include = tsconfig.include.filter(
      (x: string) =>
        !x.startsWith(
          path.relative(process.cwd(), dist).split(path.sep).join("/") + "/",
        ),
    );
    await writeFile("tsconfig.json", JSON.stringify(tsconfig, null, 2) + "\n");
    if ((await readFile("next-env.d.ts", "utf8")).includes(name + "-next/"))
      await writeFile("next-env.d.ts", previousNextEnv);
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
