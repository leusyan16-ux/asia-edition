import { gygRowSchema, type GygRow } from "./getyourguide-adapter";

/** Pasted browser tables are TSV, not provider CSV. Never execute their contents. */
export function parseGygTable(text: string, sourceFile = "Вставлений текст(20261026-154915).txt"): GygRow[] {
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error("Table exceeds 8 MiB");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = lines.shift()?.split("\t");
  if (!header || ![6,7].includes(header.length) || !["Назва", "Назва екскурсії"].includes(header[0]) || (header.length===7 && (header[5]!=="URL картинки"||header[6]!=="URL екскурсії"))) throw Error("Unexpected table header");
  return lines.map((line, i) => {
    const cells = line.split("\t");
    if (cells.length !== header.length) throw Error(`Invalid table row ${i + 2}`);
    // Spreadsheet IMAGE formulas are untrusted text, never executed.
    const [title, price, rating, features, url, image] = header.length===7 ? [cells[0],cells[1],cells[2],cells[3],cells[6],cells[5]] : cells;
    const u = new URL(url.trim());
    if (u.protocol !== "https:" || !["www.getyourguide.com", "getyourguide.com"].includes(u.hostname) || u.username || u.password || u.port) throw Error(`Unsafe URL at row ${i + 2}`);
    const id = u.pathname.match(/-t([1-9]\d*)\/?$/)?.[1];
    if (!id) throw Error(`Missing activity ID at row ${i + 2}`);
    u.search = ""; u.hash = "";
    u.pathname=u.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?\//i,'/');
    return gygRowSchema.parse({source: "GetYourGuide", source_product_id: id, source_url: u.href, title_uk: title.trim(), display_price_text: price.trim(), rating_text: rating.trim(), duration_and_features_text: features.trim(), image_url_reference: image.trim(), source_files: sourceFile});
  });
}

/** Existing nonempty facts win; later rows only fill gaps. Different IDs never merge. */
export function mergeGygRows(rows: GygRow[]) {
  const byId = new Map<string, GygRow>();
  const conflicts: {id: string; field: string; existing: string; incoming: string}[] = [];
  for (const row of rows) {
    const previous = byId.get(row.source_product_id);
    if (!previous) { byId.set(row.source_product_id, {...row}); continue; }
    for (const key of Object.keys(row) as (keyof GygRow)[]) {
      if (key === "source") continue;
      if (key === "source_files") {
        previous[key] = [...new Set([...previous[key].split("; "), ...row[key].split("; ")].filter(Boolean))].join("; ");
      } else if (key === "title_uk" && /^(?:Разів заброньовано|Імовірно, буде розпродано|Підтверджено GetYourGuide|Сертифіковано|Бестселер)/iu.test(previous[key]) && row[key].trim()) {
        conflicts.push({id: row.source_product_id, field: "replaced_non_title_label", existing: previous[key], incoming: row[key]});
        previous[key] = row[key];
      } else if (!previous[key].trim() && row[key].trim()) {
        previous[key] = row[key];
      } else if (row[key].trim() && previous[key] !== row[key] && !["rights_status", "publication_status"].includes(key)) {
        conflicts.push({id: row.source_product_id, field: key, existing: previous[key], incoming: row[key]});
      }
    }
  }
  return {rows: [...byId.values()], duplicates: rows.length - byId.size, conflicts};
}
