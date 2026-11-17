import test from "node:test";
import assert from "node:assert/strict";
import { parseGygTable, mergeGygRows } from "../src/features/admin/getyourguide-merge";
import { GetYourGuideAdapter } from "../src/features/admin/getyourguide-adapter";

test("Vietnam pasted header preserves provenance and separates Cambodia from excluded geography", () => {
  const header="Назва екскурсії\tЦіна\tРейтинг та відгуки\tТривалість / Умови\tПосилання на екскурсію\tПосилання на фото\n";
  const rows=parseGygTable(header+"ТЕСТ Ханой\t\t\t\thttps://www.getyourguide.com/hanoi-l205/test-t123/\t\nТЕСТ Пномпень\t\t\t\thttps://www.getyourguide.com/phnom-penh-l273/test-t124/\t\nТЕСТ Кітулгала\t\t\t\thttps://www.getyourguide.com/kitulgala-l148099/test-t125/\t", "test-vietnam.txt");
  assert(rows.every(r=>r.source_files==='test-vietnam.txt'));
  const result=new GetYourGuideAdapter().prepare(rows);
  assert.deepEqual(result.records.map(r=>r.product.country),['vietnam','cambodia']);
  assert.equal(result.excluded.length,1);
  assert(result.records.every(r=>r.import_status==='needs_review' && (r.product.images as unknown[]).length===0));
});

test("GetYourGuide pasted table canonicalizes IDs and merges only missing fields", () => {
  const header="Назва\tЦіна\tРейтинг / Відгуки\tТривалість та умови\tURL екскурсії\tURL картинки\n";
  const rows=parseGygTable(header+"Назва\t\t4.8\t\thttps://www.getyourguide.com/bangkok-l169/example-t123/?q=test\t\nНазва\t20 USD\t\t\thttps://www.getyourguide.com/bangkok-l169/example-t123/?ranking_uuid=other\t\nНазва\t\t\t\thttps://www.getyourguide.com/bangkok-l169/example-t124/\t");
  const merged=mergeGygRows(rows);
  assert.equal(merged.duplicates,1); assert.equal(merged.rows.length,2);
  assert.equal(merged.rows[0].display_price_text,"20 USD");
  assert.equal(merged.rows[0].rating_text,"4.8");
  assert(!merged.rows[0].source_url.includes("?"));
  const changed=mergeGygRows([...merged.rows,{...rows[0],title_uk:"Інша назва"}]);
  assert.equal(changed.rows[0].title_uk,"Назва");
  assert(changed.conflicts.some(c=>c.field==='title_uk'));
  assert.throws(()=>parseGygTable(header+"Назва\t\t\t\thttps://evil.example/bangkok-l169/example-t123/\t"));
});
