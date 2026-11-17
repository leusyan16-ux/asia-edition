import test from 'node:test';
import assert from 'node:assert/strict';
import { demoTour } from '../src/features/tours/demo';
import { tourSchema } from '../src/features/tours/model';
import { parseQuery,selectTours } from '../src/features/tours/query';
import { countries,defaultLocale } from '../src/lib/catalog';

test('exact approved geography, one labelled demo, no bookable inventory',()=>{
 assert.equal(countries.length,11);assert.equal(defaultLocale,'ru');assert.equal(demoTour.isDemo,true);assert.equal(demoTour.operator,null);assert.deepEqual(demoTour.availability,[]);
 assert.equal(countries.filter(c=>c.priority==='main').length,2);assert.equal(countries.filter(c=>c.priority==='high').length,2);assert.equal(countries.filter(c=>c.priority==='second').length,7);
 assert(!countries.some(c=>c.slug==='egypt'));assert.equal(tourSchema.safeParse({...demoTour,prices:[{...demoTour.prices[0],adult:-1}]}).success,false);
});
test('filters combine currency, price, duration, geography, categories and bilingual search',()=>{
 const query=parseQuery({country:'vietnam',location:'ha-long-bay',category:'nature',currency:'USD',minPrice:'90',maxPrice:'110',duration:'full',search:'Халонг'},'ru');
 assert.equal(selectTours([demoTour],query).total,1);
 for(const change of [{country:'turkey'},{currency:'EUR',minPrice:1},{maxPrice:99},{duration:'short' as const},{category:'city'},{search:'Egypt'}])assert.equal(selectTours([demoTour],{...query,...change}).total,0);
 assert.equal(selectTours([demoTour],{...query,search:'Ha Long'}).total,1);
 assert.equal(parseQuery({page:'-3',sort:'malicious',maxPrice:'NaN'},'ru').page,1);
});
test('pagination and ordering work for 350+ items without runtime fake inventory',()=>{
 const fixtures=Array.from({length:360},(_,i)=>({...demoTour,slug:`test-only-${i}`,prices:[{...demoTour.prices[0],adult:i+1}]}));
 const q={...parseQuery({sort:'price-desc'},'en'),page:2};const result=selectTours(fixtures,q);
 assert.equal(result.total,360);assert.equal(result.items.length,9);assert.equal(result.items[0].prices[0].adult,351);
 assert.equal(selectTours(fixtures,{...q,page:40}).items.length,9);assert.equal(selectTours(fixtures,{...q,page:41}).items.length,0);
 assert.equal(selectTours([{...demoTour,status:'draft'}],q).total,0);assert.equal(selectTours([{...demoTour,isDemo:false,verifiedAt:null}],q).total,0);
});
