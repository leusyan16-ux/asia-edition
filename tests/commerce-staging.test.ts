import test from "node:test";
import assert from "node:assert/strict";
import {
  commerceEnabled,
  commerceStagingErrors,
} from "../src/features/commerce/config";
import {
  guestCartKey,
  readGuestCart,
  syncGuestCart,
  type CartStorage,
  type CartAPI,
} from "../src/features/commerce/cart-sync";
import {
  commerceAPI,
  CommerceAPIError,
} from "../src/features/commerce/client-api";
import type { CartLine } from "../src/features/commerce/model";
const line: CartLine = {
  slug: "TEST-tour".toLowerCase(),
  date: "2027-01-20",
  adults: 2,
  children: 0,
  options: "",
};
function store(): CartStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}
test("Dedicated staging refuses the existing project, production target/origin, server keys and missing configuration", () => {
  const env = {
    COMMERCE_ENABLED: "true",
    PUBLIC_PREVIEW_ONLY: "false",
    COMMERCE_ENVIRONMENT: "staging",
    COMMERCE_STAGING_PROJECT_REF: "abcdefghijklmnopqrst",
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_TEST_ONLY",
    SITE_URL: "https://asia-edition-staging-example.vercel.app",
    VERCEL_ENV: "preview",
    TOUR_DATA_SOURCE: "static",
    ADMIN_MODE: "disabled",
    POSTGRES_REMOTE_ENABLED: "false",
    COMMERCE_GOOGLE_ENABLED: "false",
  };
  assert.deepEqual(commerceStagingErrors(env), []);
  assert(commerceEnabled(env));
  for (const diff of [
    {
      COMMERCE_STAGING_PROJECT_REF: "xvzrgnrzbesqwsribpdm",
      NEXT_PUBLIC_SUPABASE_URL: "https://xvzrgnrzbesqwsribpdm.supabase.co",
    },
    { SITE_URL: "https://asia-edition.vercel.app" },
    { VERCEL_ENV: "production" },
    { NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_TEST" },
    {
      NEXT_PUBLIC_SUPABASE_ANON_KEY:
        "x." +
        Buffer.from('{"role":"service_role"}').toString("base64url") +
        ".x",
    },
    { TOUR_DATA_SOURCE: "supabase" },
    { ADMIN_MODE: "supabase" },
    {
      NEXT_PUBLIC_SUPABASE_URL:
        "https://abcdefghijklmnopqrst.supabase.co/?token=bad",
    },
  ])
    assert(!commerceEnabled({ ...env, ...diff }));
  assert(!commerceEnabled({ COMMERCE_ENABLED: "false" }));
});
test("Cart sync acknowledges before clearing, preserves concurrent additions and retains local cart after conflict", async () => {
  const storage = store();
  storage.setItem(guestCartKey, JSON.stringify([line]));
  let calls = 0;
  const api: CartAPI = async (_path, body) => {
    calls++;
    if (body) {
      assert.equal(readGuestCart(storage).length, 1);
      storage.setItem(
        guestCartKey,
        JSON.stringify([line, { ...line, slug: "second-tour" }]),
      );
      return { ok: true };
    }
    return { items: [line], revision: 2 };
  };
  await syncGuestCart(api, storage);
  assert.equal(calls, 3);
  assert.deepEqual(
    readGuestCart(storage).map((x) => x.slug),
    ["second-tour"],
  );
  await assert.rejects(
    syncGuestCart(async (_p, b) => {
      if (b) throw Error("409");
      return { items: [], revision: 0 };
    }, storage),
  );
  assert.equal(readGuestCart(storage).length, 1);
  await syncGuestCart(async () => ({ items: [], revision: 1 }), storage);
  assert.equal(storage.getItem(guestCartKey), null);
  storage.setItem(guestCartKey, '{"invalid":true}');
  assert.throws(() => readGuestCart(storage));
});
test("API refresh is bounded and single-flight; login errors/conflicts never trigger refresh", async () => {
  const original = globalThis.fetch;
  let refreshes = 0;
  let ready = false;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      calls.push(path);
      assert.equal(init?.credentials, "same-origin");
      if (path.endsWith("/refresh")) {
        refreshes++;
        await new Promise((r) => setTimeout(r, 10));
        ready = true;
        return Response.json({ ok: true });
      }
      return Response.json(ready ? [] : { error: "authentication_required" }, {
        status: ready ? 200 : 401,
      });
    };
    await Promise.all([commerceAPI("orders"), commerceAPI("documents")]);
    assert.equal(refreshes, 1);
    assert.equal(calls.length, 5);
    ready = false;
    refreshes = 0;
    await assert.rejects(
      commerceAPI("login", { email: "test@example.test" }),
      (e) => e instanceof CommerceAPIError && e.status === 401,
    );
    assert.equal(refreshes, 0);
    globalThis.fetch = async () =>
      Response.json({ error: "cart_conflict" }, { status: 409 });
    await assert.rejects(
      commerceAPI("cart", {}),
      (e) => e instanceof CommerceAPIError && e.status === 409,
    );
  } finally {
    globalThis.fetch = original;
  }
});
