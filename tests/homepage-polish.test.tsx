import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {CountryCollection,Footer} from '../src/components/travel';
import {TravelSearch} from '../src/components/search';
import {countries} from '../src/lib/catalog';
const activeCountries=countries.filter(c=>c.slug!=='myanmar').map(c=>c.slug);

test('Homepage collection keeps regional records but links only populated destinations',async()=>{
 assert.equal(countries.length,11);
 const photos=countries.filter(c=>!c.image.endsWith('.svg'));assert.equal(photos.length,10);
 for(const c of photos){assert(existsSync('public'+c.image));assert(readFileSync('public'+c.image).length>10000);}
 for(const locale of ['ru','en'] as const){const html=renderToStaticMarkup(await CountryCollection({locale,activeCountries}));assert.equal((html.match(/class="country-card"/g)||[]).length,10);assert(!html.includes('country-group-heading'));assert(!html.includes('.svg'));assert(!html.includes(`/${locale}/countries/myanmar`));}
});
test('Footer provides populated destinations and manager contact without technical material',async()=>{
 for(const locale of ['ru','en'] as const){const html=renderToStaticMarkup(await Footer({locale,activeCountries}));for(const c of countries.filter(c=>activeCountries.includes(c.slug)))assert(html.includes(`/${locale}/countries/${c.slug}`));assert(html.includes(`/${locale}/tours`));assert(html.includes('https://t.me/VN_instal'));assert(!html.includes('ASSET-SOURCES'));assert(!html.includes('согласовываются отдельно'));assert(!html.includes('/countries/myanmar'));assert(!html.includes('/admin'));assert(!html.includes('/account'));assert(!html.includes('DEMO'));}
});
test('Homepage search submits bounded search to the existing catalogue',()=>{
 for(const locale of ['ru','en'] as const){const html=renderToStaticMarkup(<TravelSearch locale={locale}/>);assert(html.includes(`action="/${locale}/tours"`));assert(html.includes('name="search"'));assert(html.includes('maxLength="100"'));assert(html.includes('method="get"'));}
});
