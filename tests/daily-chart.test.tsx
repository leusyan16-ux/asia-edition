import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {dailyChartData,chartScale,afterChartCursor} from "../src/features/commerce/chart-model";
import {DailyActivityChart} from "../src/features/commerce/daily-chart";

test("daily chart fills the complete UTC period, keeps real counts, and preserves unknown retention days",()=>{
  const visits=new Map([["2026-11-11",2],["2026-11-09",1]]),requests=new Map([["2026-11-10",4]]);
  const seven=dailyChartData(7,"2026-11-11",visits,requests);
  assert.equal(seven.points.length,7);assert.equal(seven.points[0].day,"2026-11-05");
  assert.deepEqual(seven.points[0],{day:"2026-11-05",visits:0,requests:0});
  assert.equal(seven.points[5].requests,4);assert.equal(seven.points[6].visits,2);
  assert.equal(dailyChartData(30,"2026-11-11",visits,requests).points.length,30);
  const ninety=dailyChartData(90,"2026-11-11",visits,requests);
  assert.equal(ninety.points.length,90);assert.equal(ninety.knownVisitDays,36);
  assert.equal(ninety.points[0].visits,null);assert.equal(ninety.points[0].requests,0);
  assert.equal(ninety.points.reduce((n,p)=>n+(p.visits??0),0),3);
  assert.equal(ninety.points.reduce((n,p)=>n+p.requests,0),4);
});
test("chart scales have integer non-zero axes for zero, small and large counts",()=>{
  for(const n of [0,1,2,7,33,998,10000,1500000]){
    const scale=chartScale(n);assert.equal(scale.ticks.length,5);assert.equal(scale.ticks[0],0);
    assert(scale.top>=n&&scale.top>0);assert(scale.ticks.every(Number.isInteger));
  }
});
test("chart rendering exposes all days, axes, legend, exact values and accessible period links",()=>{
  for(const period of [7,30,90] as const){
    const data=dailyChartData(period,"2026-11-11",new Map([["2026-11-11",1234567]]),new Map([["2026-11-10",3]]));
    const html=renderToStaticMarkup(<DailyActivityChart data={data}/>);
    assert.equal((html.match(/class="chart-day/g)??[]).length,period*2); // group + hit rectangle
    assert(html.includes("Количество"));assert(html.includes("Дата · UTC"));
    assert(html.includes("Посещения за период"));assert(html.includes("Заявки за период"));
    assert(html.includes("chartDays=90"));assert(html.includes("chartDays=30"));
    assert(html.includes("11 ноября 2026"));assert(html.includes("1234567")||html.includes("1 234 567"));
    assert(html.includes('role="button"'));assert(html.includes("после согласия"));
    if(period===90)assert(html.includes("не ноль"));
  }
  const empty=renderToStaticMarkup(<DailyActivityChart data={dailyChartData(7,"2026-11-11",new Map(),new Map())}/>);
  assert(empty.includes("Нулевые дни"));assert(!empty.includes("NaN"));assert(!empty.includes("Infinity"));
});
test("keyset cursors use all primary-key dimensions and escape values instead of interpolating SQL",()=>{
  const cursor=afterChartCursor(["day","detail"],{day:"2026-11-11",detail:'a,b"c'});
  assert.equal(cursor,'day.gt."2026-11-11",and(day.eq."2026-11-11",detail.gt."a,b\\"c")');
});
