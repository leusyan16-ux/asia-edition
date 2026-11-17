import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGygTable} from '../src/features/admin/getyourguide-merge';
import {GetYourGuideAdapter} from '../src/features/admin/getyourguide-adapter';
import {geographyError} from '../src/lib/geography';

test('Timor-Leste: Dili is an allowed SEA city, source prices retain USD and group conditions',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const p=new GetYourGuideAdapter().prepare(parseGygTable(h+'ТЕСТ Ділі\t920 USD\t\t3 дні • за групу до 4\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/dili-l970/test-tour-t999911/')).records[0];
 assert.equal(p.product.country,'timor-leste');
 assert.equal(p.locations?.[0].kind,'city');
 assert.equal(p.source_metadata?.price_observation && (p.source_metadata.price_observation as {currency:string}).currency,'USD');
 assert.deepEqual(p.product.prices,[]);
});

test('Myanmar search label does not override the actual Mae Sai Thailand destination',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const result=new GetYourGuideAdapter().prepare(parseGygTable(h+'ТЕСТ: чайні плантації Чіанграя\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/mae-sai-l235270/from-chiang-rai-tea-plantations-and-mountain-villages-tour-t999921/?q=Myanmar'));
 assert.equal(result.records[0].product.country,'thailand');
 assert.equal(result.records[0].locations?.[0].kind,'city');
});

test('Brunei: country, district and city source locations map without reclassifying Kuching',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const paths=['brunei-l169076','brunei-muara-district-l202284','bandar-seri-begawan-l496','sengkurong-l244391','kuching-l2067'];
 const rows=paths.map((p,i)=>`ТЕСТ\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/${p}/test-tour-t${999931+i}/`);
 const result=new GetYourGuideAdapter().prepare(parseGygTable(h+rows.join('\n')));
 assert.equal(result.excluded.length,0);
 assert.deepEqual(result.records.map(r=>r.product.country),['brunei','brunei','brunei','brunei','malaysia']);
 assert.equal(result.records[2].locations?.[0].kind,'city');
});

test('Laos: supplied cities and explicit Thailand-to-Laos routes retain correct geography',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const row=(path:string,id:number)=>`ТЕСТ Laos\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/${path}-t${id}/`;
 const prepared=new GetYourGuideAdapter().prepare(parseGygTable(h+row('vang-vieng-l2838/test',999941)+'\n'+row('nong-khiaw-l144976/test',999942)+'\n'+row('chiang-rai-l913/chiang-rai-slow-boat-to-luang-prabang-with-dormitory',999943)+'\n'+row('chiang-rai-l913/transfer-sunrise-at-phu-chifa',999944)));
 assert.deepEqual(prepared.records.map(r=>r.product.country),['laos','laos','laos','thailand']);
 assert.deepEqual(prepared.records[2].product.routeCountries,['thailand','laos']);
 assert.equal(prepared.records[0].locations?.[0].kind,'city');
});
test('Singapore TSV: formula stays inert, localized URL canonicalized, safe neighbourhood and destination mapping',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const row=(title:string,path:string,id:number)=>`${title}\t\t\t\t=IMAGE("ignored")\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/${path}-t${id}/?q=Singapore`;
 const rows=parseGygTable(h+row('ТЕСТ: Little India Singapore','singapore-l170/little-india',999991)+'\n'+row('ТЕСТ: Batam from Singapore','singapore-l170/from-singapore-batam-tour',999992));
 assert(!rows[0].source_url.includes('uk-ua'));assert(!rows[0].source_url.includes('?'));
 const prepared=new GetYourGuideAdapter().prepare(rows);assert.deepEqual(prepared.excluded,[]);
 assert.deepEqual(prepared.records.map(r=>r.product.country),['singapore','indonesia']);
 assert.equal(geographyError({country:'singapore',title:{ru:'Маленькая Индия и Китайский квартал',en:'Little India and Chinatown'}}),null);
 assert(geographyError({country:'singapore',title:'Little India then Russia'}));
 assert(geographyError({country:'singapore',title:'Little India then India'}));
 assert(geographyError({country:'singapore',title:'Chinatown',routeCountries:['china']}));
 const conflicting=parseGygTable(h+row('ТЕСТ: Singapore tour','johor-bahru-l420/singapore-private-tour',999993));
 assert.equal(new GetYourGuideAdapter().prepare(conflicting).excluded.length,1);
});
test('Indonesia import: allow supplied destination, hold conflicting temple/salt-making row',()=>{
 const header='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const make=(title:string,path:string)=>`${title}\t\t\t\t=IMAGE("not-executed")\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/${path}`;
 const good=parseGygTable(header+make('ТЕСТ: сноркелінг на островах Гілі','gili-islands-l2491/test-snorkeling-t999981/'));
 assert.equal(new GetYourGuideAdapter().prepare(good).records[0].product.country,'indonesia');
 const bad=parseGygTable(header+make('Приватний тур: Лемпуянг, Тірта-Ганга','kusamba-l238760/bali-traditional-salt-making-tour-t999982/'));
 assert.match(new GetYourGuideAdapter().prepare(bad).excluded[0].reason,/salt making/);
});
test('Malaysia: existing adapter maps KL and allows its Little India without allowing an India route',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const rows=parseGygTable(h+'ТЕСТ: Kuala Lumpur Chinatown Little India\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/kuala-lumpur-l171/chinatown-little-india-tour-t999971/');
 assert.equal(new GetYourGuideAdapter().prepare(rows).records[0].product.country,'malaysia');
 assert.equal(geographyError({country:'malaysia',title:'Little India and Chinatown'}),null);
 assert(geographyError({country:'malaysia',title:'Little India then India'}));
 assert(geographyError({country:'malaysia',routeCountries:['russia']}));
});
test('Philippines: Boracay and Malay map correctly; whales are not an excluded China destination',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const rows=parseGygTable(h+'ТЕСТ: круїз з червоними китами\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/boracay-l499/red-whale-boracay-cruise-t999961/');
 assert.equal(new GetYourGuideAdapter().prepare(rows).records[0].product.country,'philippines');
 assert.equal(geographyError({country:'philippines',title:'Плавание с китами'}),null);
 assert(geographyError({country:'philippines',title:'Перелёт в Китай'}));
 assert(geographyError({country:'philippines',title:'Поездка по Китаю'}));
 assert(geographyError({country:'philippines',routeCountries:['russia']}));
 const malay=parseGygTable(h+'ТЕСТ Malay Boracay\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/malay-l205937/test-tour-t999962/');
 assert.equal(new GetYourGuideAdapter().prepare(malay).records[0].product.country,'philippines');
});
test('Cambodia: explicit cross-border destination retains departure country without treating Vietnamese-only activities as Cambodian',()=>{
 const h='Назва екскурсії\tЦіна\tРейтинг / Відгуки\tТривалість та деталі\tФото (прев’ю)\tURL картинки\tURL екскурсії\n';
 const rows=parseGygTable(h+'ТЕСТ: з Бангкока до Сіємреапа\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/bangkok-l169/from-bangkok-2-day-siem-reap-tour-with-angkor-wat-t999951/');
 const p=new GetYourGuideAdapter().prepare(rows).records[0];assert.equal(p.product.country,'cambodia');assert.deepEqual(p.product.routeCountries,['thailand','cambodia']);
 const city=parseGygTable(h+'ТЕСТ: Сіємреап\t\t\t\t\thttps://cdn.getyourguide.com/image/test.jpg\thttps://www.getyourguide.com/uk-ua/siem-reap-l274/test-temple-tour-t999952/');
 assert.equal(new GetYourGuideAdapter().prepare(city).records[0].product.country,'cambodia');
});
