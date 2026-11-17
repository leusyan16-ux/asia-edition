import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { tourSchema } from '../src/features/tours/model';

test('PostgreSQL migration, RLS, verified publication, RPC model and catalog scale',async()=>{
 const db=new PGlite();
 try{
 await db.exec('create role anon; create role authenticated; grant usage on schema public to anon,authenticated;');
 await db.exec(await readFile('supabase/migrations/202610100001_tour_inventory.sql','utf8'));
 assert.equal((await db.query<{count:number}>('select count(*)::int count from countries')).rows[0].count,13);
 await assert.rejects(db.exec("insert into countries values('egypt','Test','Test','main')"));
 await assert.rejects(db.exec("insert into locations(country_slug,slug,kind,name_ru,name_en) values('turkey','unverified-region','resort','Test','Test')"));
 const loc=(await db.query<{id:string}>("insert into locations(country_slug,slug,kind,name_ru,name_en) values('vietnam','test-only','resort','Тест','Test') returning id")).rows[0].id;
 const op=(await db.query<{id:string}>("insert into operators(name,verified_at) values('TEST ONLY — not an operator',now()) returning id")).rows[0].id;
 await db.query('insert into supplier_details(operator_id,email) values($1,$2)',[op,'private-test@example.invalid']);
 const id=(await db.query<{id:string}>('insert into tours(slug,country_slug,location_id,category_slug,operator_id) values($1,$2,$3,$4,$5) returning id',['test-only-tour','vietnam',loc,'nature',op])).rows[0].id;
 await assert.rejects(db.query("update tours set timezone='Invalid/Timezone' where id=$1",[id]));
 await assert.rejects(db.query("update tours set status='published',verified_at=now() where id=$1",[id]));
 await db.query("insert into tour_translations(tour_id,locale,title,description) values($1,'ru','Тест',array['Только тест']),($1,'en','Test',array['Test only'])",[id]);
 await db.query("insert into tour_images(tour_id,url,alt_ru,alt_en,position) values($1,'/images/vietnam.jpg','Тест','Test',0)",[id]);
 await db.query("update tours set status='published',verified_at=now(),duration_minutes=480 where id=$1",[id]);
 await assert.rejects(db.query("insert into tour_prices(tour_id,currency,adult) values($1,'USD',-1)",[id]));
 await assert.rejects(db.query("insert into tour_availability(tour_id,service_date,departure_time,capacity,reserved) values($1,'2099-01-01','09:00',1,2)",[id]));
 await db.query("insert into tour_prices(tour_id,currency,adult,verified_at) values($1,'USD',80,now()),($1,'EUR',99,null)",[id]);
 await db.query("insert into tour_availability(tour_id,service_date,departure_time,capacity,reserved,status,verified_at) values($1,'2099-01-01','09:00',5,2,'available',now()),($1,'2099-01-02','09:00',5,0,'available',null)",[id]);
 await db.query("insert into tours(slug,country_slug,location_id,category_slug) values('hidden-draft','vietnam',$1,'nature')",[loc]);
 await db.exec('set role anon');
 assert.equal((await db.query('select * from tours')).rows.length,1);assert.equal((await db.query('select * from supplier_details')).rows.length,0);
 await assert.rejects(db.query("update tours set slug='forbidden'"));
 const payload=(await db.query<{data:unknown}>('select tour_detail($1) data',['test-only-tour'])).rows[0].data;
 const parsed=tourSchema.parse(payload);assert.equal(parsed.prices.length,1);assert.equal(parsed.availability.length,1);assert.equal(parsed.availability[0].remaining,3);assert.equal(parsed.images.length,1);
 assert.equal((await db.query<{data:unknown}>("select tour_detail('hidden-draft') data")).rows[0].data,null);
 await db.exec('reset role');
 // Test-only records exist solely in this transient database, never in runtime demo content.
 await db.query("insert into tours(slug,country_slug,location_id,category_slug,operator_id,duration_minutes) select 'scale-test-'||n,'vietnam',$1,'nature',$2,480 from generate_series(1,360) n",[loc,op]);
 await db.exec("insert into tour_translations(tour_id,locale,title,description) select t.id,l,'TEST ONLY',array['TEST ONLY'] from tours t cross join unnest(array['ru','en']) l where t.slug like 'scale-test-%'; insert into tour_images(tour_id,url,alt_ru,alt_en,position) select id,'/images/vietnam.jpg','TEST','TEST',0 from tours where slug like 'scale-test-%'; update tours set status='published',verified_at=now() where slug like 'scale-test-%';");
 await db.exec("insert into tour_prices(tour_id,currency,adult,verified_at) select id,'USD',substring(slug from 12)::numeric,now() from tours where slug like 'scale-test-%';");
 await db.exec('set role anon');
 const page=(await db.query<{data:{total:number;items:unknown[]}}>('select tour_catalog($1::jsonb) data',[JSON.stringify({country:'vietnam',page:2,pageSize:9})])).rows[0].data;
 assert.equal(page.total,361);assert.equal(page.items.length,9);page.items.forEach(i=>tourSchema.parse(i));
 const sorted=(await db.query<{data:{items:unknown[]}}>('select tour_catalog($1::jsonb) data',[JSON.stringify({sort:'price-desc',currency:'USD',page:2,pageSize:9})])).rows[0].data;
 assert.equal(tourSchema.parse(sorted.items[0]).prices[0].adult,351);
 const priced=(await db.query<{data:{total:number}}>('select tour_catalog($1::jsonb) data',[JSON.stringify({currency:'USD',minPrice:300})])).rows[0].data;assert.equal(priced.total,61);
 const empty=(await db.query<{data:{total:number}}>('select tour_catalog($1::jsonb) data',[JSON.stringify({country:'turkey'})])).rows[0].data;assert.equal(empty.total,0);
 }finally{await db.close()}
});
