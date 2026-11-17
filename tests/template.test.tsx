import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { TourDetail } from '../src/features/tours/components/detail';
import { demoTour } from '../src/features/tours/demo';
import { tourSchema } from '../src/features/tours/model';
const taxonomy={locations:[{slug:'ha-long-bay',country:'vietnam',name:{ru:'Халонг',en:'Ha Long'}}],categories:[]};
test('template renders complete sample and hides absent localized sections',()=>{
 const full=renderToStaticMarkup(<TourDetail tour={demoTour} locale="ru" related={[]} taxonomy={taxonomy}/>);
 assert(full.includes('Программа по шагам'));assert(full.includes('Вопросы и ответы'));assert(full.includes('ДЕМОНСТРАЦИЯ'));assert(!full.includes('Другие экскурсии'));
 const sparse=tourSchema.parse({...demoTour,images:[],highlights:{ru:[],en:[]},description:{ru:[],en:[]},itinerary:[],inclusions:{ru:[],en:[]},exclusions:{ru:[],en:[]},meeting:null,pickup:null,cancellation:null,bookingConditions:null,faq:[{question:{ru:'',en:'Question'},answer:{ru:'',en:'Answer'}}],prices:[],transportation:null,schedule:null});
 const html=renderToStaticMarkup(<TourDetail tour={sparse} locale="ru" related={[]} taxonomy={taxonomy}/>);
 for(const id of ['overview','itinerary','services','meeting','conditions','faq'])assert(!html.includes(`id="${id}"`),id);
 assert(!html.includes('Вопросы и ответы'));assert(html.includes('Стоимость требует подтверждения'));
});
