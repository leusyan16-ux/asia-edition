import test from "node:test";
import assert from "node:assert/strict";
import { adminReturnPath } from "../src/features/commerce/admin-navigation";
import { commerceAPI, CommerceAPIError } from "../src/features/commerce/client-api";

test("admin recovery accepts only fixed internal return routes", () => {
  for (const path of ["/admin/analytics","/admin/orders","/admin/customers","/admin/staff"])
    assert.equal(adminReturnPath(path),path);
  for (const path of [undefined,"https://example.test","//example.test","/api/commerce/logout","/admin/login","/admin/orders?next=https://example.test"])
    assert.equal(adminReturnPath(path),"/admin/analytics");
});

test("admin session recovery renews once with HttpOnly credentials and rechecks server role", async () => {
  const original = globalThis.fetch;
  const calls: {path:string; method:string; credentials:RequestCredentials|undefined}[] = [];
  globalThis.fetch = async (url, options) => {
    const path=String(url);
    calls.push({path,method:options?.method ?? "GET",credentials:options?.credentials});
    return new Response(JSON.stringify(path.endsWith("refresh") ? {} : calls.length===1 ? {error:"unauthorized"} : {user:{id:"fixture"},adminRole:"owner"}),
      {status:calls.length===1 ? 401 : 200,headers:{"Content-Type":"application/json"}});
  };
  try {
    assert.equal((await commerceAPI("session")).adminRole,"owner");
    assert.deepEqual(calls.map(c=>[c.path,c.method]),[
      ["/api/commerce/session","GET"],["/api/commerce/refresh","POST"],["/api/commerce/session","GET"],
    ]);
    assert(calls.every(c=>c.credentials==="same-origin"));
  } finally { globalThis.fetch=original; }
});

test("failed session refresh cannot grant admin access or loop", async () => {
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:"authentication_required"}),{status:401});};
  try {
    await assert.rejects(commerceAPI("session"),error=>error instanceof CommerceAPIError && error.status===401);
    assert.equal(calls,2);
  } finally { globalThis.fetch=original; }
});
