import test from "node:test";
import assert from "node:assert/strict";
import {dashboardRefreshInterval,scheduleDashboardRefresh} from "../src/features/commerce/refresh-scheduler";

test("Dashboard polls every 30 seconds, pauses safely, catches up and cleans up listeners",()=>{
  let now=0,busy=false,visible=true,online=true,refreshes=0,cleared=false;
  let tick:()=>void=()=>{};
  const listeners=new Map<string,()=>void>();
  const stop=scheduleDashboardRefresh({
    refresh:()=>{refreshes++;},busy:()=>busy,visible:()=>visible,online:()=>online,now:()=>now,
    interval:(fn,ms)=>{assert.equal(ms,30000);tick=fn;return 9;},clear:timer=>{assert.equal(timer,9);cleared=true;},
    listen:(event,fn)=>{listeners.set(event,fn);return()=>{listeners.delete(event);};},
  });
  assert.equal(dashboardRefreshInterval,30000);assert.equal(refreshes,0);
  now=30000;tick();assert.equal(refreshes,1);
  now=60000;busy=true;tick();assert.equal(refreshes,1);
  busy=false;visible=false;now=90000;tick();assert.equal(refreshes,1);
  visible=true;listeners.get("visibilitychange")!();assert.equal(refreshes,2);
  listeners.get("focus")!();stop.refreshNow();assert.equal(refreshes,2);
  online=false;now=120000;tick();assert.equal(refreshes,2);
  online=true;listeners.get("online")!();assert.equal(refreshes,3);
  now=122000;stop.refreshNow();assert.equal(refreshes,4);
  stop();assert(cleared);assert.equal(listeners.size,0);now=150000;tick();assert.equal(refreshes,4);
});
