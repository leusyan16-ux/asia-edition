import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {destinationPhoto} from '../src/features/tours/destination-photo';
import {TourCards} from '../src/features/tours/components/cards';
import {TourDetail} from '../src/features/tours/components/detail';
import {snapshotSchema} from '../src/features/tours/static-catalog';
test('All 2319 public cards have a real local destination fallback; original photos and records unchanged',()=>{
 const s=snapshotSchema.parse(JSON.parse(readFileSync('src/features/tours/published-catalog.json','utf8')));const before=JSON.stringify(s);let missing=0;
 for(const r of s.records){for(const locale of ['ru','en'] as const){const p=destinationPhoto(r.tour.country,locale);assert(p);assert(existsSync('public'+p.src));assert(p.label.includes(locale==='ru'?'Фото направления':'Destination photo'));}if(!r.tour.images.length)missing++;}
 assert.equal(s.records.length,2319);assert.equal(missing,17);assert.equal(JSON.stringify(s),before);assert.equal(destinationPhoto('myanmar','ru'),undefined);assert.equal(destinationPhoto('russia','en'),undefined);
});
test('All 17 photo-less records render labeled context photos in cards and details RU/EN',()=>{
 const s=snapshotSchema.parse(JSON.parse(readFileSync('src/features/tours/published-catalog.json','utf8')));
 for(const r of s.records.filter(r=>!r.tour.images.length))for(const locale of ['ru','en'] as const){
 const cards=renderToStaticMarkup(<TourCards items={[r.tour]} locale={locale}/>);assert(cards.includes('photo-context-label'));assert(!cards.includes('tour-card-placeholder'));
 const detail=renderToStaticMarkup(<TourDetail tour={r.tour} locale={locale} taxonomy={s.taxonomy} related={[]}/>);assert(detail.includes('destination-context-photo'));assert(detail.includes(locale==='ru'?'Фото направления':'Destination photo'));
 }
});
