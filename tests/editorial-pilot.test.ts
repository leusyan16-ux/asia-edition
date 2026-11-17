import test from "node:test";
import assert from "node:assert/strict";
import { validateEditorialPilot } from "../scripts/validate-editorial-pilot";

test("editorial pilot: 26 archived sources preserved; 10 regional drafts, CSV/JSON parity and isolated idempotence", async () => {
  const report = await validateEditorialPilot();
  assert.equal(report.remaining_records, 10);
  assert.equal(report.published, 0);
  assert.equal(report.source_records,26);
  assert.equal(report.excluded_by_current_region,16);
  assert.equal(report.json_reimport.skipped, 10);
  assert.equal(report.csv_reimport.skipped, 10);
  assert.equal(report.working_catalog_written, false);
});
