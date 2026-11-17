import test from "node:test";
import assert from "node:assert/strict";
import { consentKey, consentLifetime,storedConsent,saveConsent,cookieConsent } from "../src/features/commerce/consent-storage";
import {safeAnalyticsDetail} from "../src/features/commerce/analytics-privacy";

test("explicit yes/no persists with expiry, legacy choice is retained, malformed values fail closed",()=>{
  const map=new Map<string,string>();const store={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);}};
  assert.equal(storedConsent(store,1000),null);
  for(const choice of ["yes","no"] as const){
    saveConsent(store,choice,1000);assert.equal(storedConsent(store,1001),choice);
    assert.equal(storedConsent(store,1000+consentLifetime*1000),null);
  }
  for(const raw of ["true","false","{",JSON.stringify({version:1,choice:"yes",expiresAt:Infinity}),JSON.stringify({version:2,choice:"yes",expiresAt:10000})]){
    map.set(consentKey,raw);assert.equal(storedConsent(store,1000),null);
  }
  map.set(consentKey,"no");assert.equal(storedConsent(store,1000),"no");
  map.set(consentKey,"yes");assert.equal(storedConsent(store,1000),"yes");
  assert.equal(cookieConsent("other=1; ae-analytics=no; cart=x"),"no");
  assert.equal(cookieConsent("ae-analytics=yes"),"yes");
  assert.equal(cookieConsent("ae-analytics=yes-please"),null);
});
test("analytics dimensions reject contact information, URLs and account-like identifiers",()=>{
  for(const text of ["name@example.test","+1 202 555 0199","https://example.test/private","www.example.test","<script>","account 12-345-678"])
    assert.equal(safeAnalyticsDetail(text),"");
  assert.equal(safeAnalyticsDetail("  boat tour  "),"boat tour");
  assert.equal(safeAnalyticsDetail("location=gyg-l123456"),"location=gyg-l123456");
  assert.equal(safeAnalyticsDetail("x".repeat(200)).length,120);
});
