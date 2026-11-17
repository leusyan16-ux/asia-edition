import { createHash } from "node:crypto";

/** Passive offline HAR extraction. No request replay, endpoint assumptions or network code. */
type Entry = {
  request?: { url?: string };
  response?: {
    status?: number;
    content?: { mimeType?: string; text?: string; encoding?: string };
  };
};
const MAX_BODY = 16 * 1024 * 1024;
const safeKeys = new Set(
  `success result activity_id currency_symbol spu_group_info first_spu_detail first_group_max_spu_num group_id name desc spu_list spu_id spu_name spu_desc spu_icon_items title track description content has_stocks best_sku_id price_status publish_info publish_status publish_status_desc published_time_utc from_price_participant_time price_show sale_price sale_price_value from_price from_price_value underline_price underline_price_strike underline_format save_price free_text spu_basic template_id is_support_shopping_cart sub_category_id icon_items sections section_type section_name_en components type data props field_key render_obj images image_url image_alt image_desc`.split(
    " ",
  ),
);
function publicPackageFields(value: unknown, depth = 0): unknown {
  if (depth > 30) throw Error("Response nesting exceeds 30");
  if (Array.isArray(value))
    return value.map((v) => publicPackageFields(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => safeKeys.has(k))
        .map(([k, v]) => [k, publicPackageFields(v, depth + 1)]),
    );
  return value;
}
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
function attr(tag: string, key: string) {
  const m = new RegExp(
    `(?:^|\\s)${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  return (m?.[1] ?? m?.[2] ?? "").replace(
    /&(amp|quot|apos|nbsp|lt|gt);/g,
    (_, k: string) =>
      ({ amp: "&", quot: '"', apos: "'", nbsp: " ", lt: "<", gt: ">" })[k]!,
  );
}
/** Only inert product metadata, not scripts, forms, cookies or account-page HTML. */
function metadataHtml(html: string, url: string) {
  if (/<title[^>]*>[^<]*(?:access denied|just a moment|captcha)/i.test(html))
    throw Error("Challenge document held");
  const tags: string[] = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attr(tag, "property") || attr(tag, "name");
    if (
      /^(?:og:(?:title|description|url|locale|image)|description|(?:product|og):price:(?:amount|currency))$/.test(
        key,
      )
    )
      tags.push(
        `<meta property="${escape(key)}" content="${escape(attr(tag, "content"))}">`,
      );
  }
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attr(m[1], "type").split(";")[0] !== "application/ld+json") continue;
    try {
      const j = JSON.parse(m[2]);
      tags.push(
        `<script type="application/ld+json">${JSON.stringify(j).replaceAll("<", "\\u003c")}</script>`,
      );
    } catch {
      /* existing parser also holds missing metadata */
    }
  }
  const title = html.match(/<title\b[^>]*>([^<]*)<\/title\s*>/i)?.[1] ?? "";
  const lang = attr(html.match(/<html\b[^>]*>/i)?.[0] ?? "", "lang");
  return `<!doctype html><html lang="${escape(lang)}"><head><link rel="canonical" href="${escape(url)}"><title>${title}</title>${tags.join("")}</head><body></body></html>`;
}

export function extractKlookHar(payload: unknown) {
  const entries = (payload as { log?: { entries?: unknown } })?.log?.entries;
  if (!Array.isArray(entries) || entries.length > 20000)
    throw Error("Expected HAR log.entries, at most 20000 entries");
  const documents = new Map<string, string>(),
    packages = new Map<string, unknown>();
  const conflicts = new Set<string>();
  const issues: { entry: number; reason: string }[] = [];
  let duplicates = 0,
    ignored = 0,
    missingBodies = 0;
  const put = (map: Map<string, unknown>, id: string, value: unknown) => {
    if (map.has(id)) {
      if (JSON.stringify(map.get(id)) === JSON.stringify(value)) duplicates++;
      else conflicts.add(id);
    } else map.set(id, value);
  };
  for (const [index, item] of entries.entries()) {
    const e = item as Entry;
    try {
      const url = new URL(e.request?.url ?? "");
      if (
        url.protocol !== "https:" ||
        !["www.klook.com", "klook.com"].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.port ||
        e.response?.status !== 200
      ) {
        ignored++;
        continue;
      }
      const c = e.response.content;
      if (!c?.text) {
        missingBodies++;
        continue;
      }
      if (c.text.length > MAX_BODY * 1.4) throw Error("Body exceeds limit");
      if (c.encoding && c.encoding !== "base64")
        throw Error("Unsupported HAR encoding");
      const bytes = Buffer.from(
        c.text,
        c.encoding === "base64" ? "base64" : "utf8",
      );
      if (bytes.length > MAX_BODY) throw Error("Body exceeds 16 MiB");
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      const activity =
        /^\/(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?activity\/(\d+)(?:-[a-z0-9-]+)?\/?$/i.exec(
          url.pathname,
        )?.[1];
      if (activity && c.mimeType?.includes("text/html")) {
        const cleanUrl = `https://www.klook.com${url.pathname}`;
        put(documents, activity, metadataHtml(body, cleanUrl));
      } else if (c.mimeType?.includes("json")) {
        if (bytes.length > 8 * 1024 * 1024)
          throw Error("Package response exceeds 8 MiB");
        const j = JSON.parse(body.replace(/^\uFEFF/, ""));
        const id = String(j?.result?.activity_id ?? "");
        if (
          j?.success !== true ||
          !Array.isArray(j?.result?.spu_group_info) ||
          !/^[1-9]\d{0,19}$/.test(id)
        ) {
          ignored++;
          continue;
        }
        if (
          typeof j.result.activity_id === "number" &&
          !Number.isSafeInteger(j.result.activity_id)
        )
          throw Error("Unsafe activity ID");
        put(packages, id, publicPackageFields(j));
      } else ignored++;
    } catch (error) {
      issues.push({
        entry: index,
        reason: error instanceof Error ? error.message : "Invalid entry",
      });
    }
  }
  const ids = [...new Set([...documents.keys(), ...packages.keys()])].sort();
  const products = ids.map((id) => ({
    id,
    html: documents.get(id) ?? null,
    packages: packages.get(id) ?? null,
    held: conflicts.has(id) || !documents.has(id),
    reason: conflicts.has(id)
      ? "Conflicting captures; select one consistent snapshot"
      : !documents.has(id)
        ? "HTML response body missing"
        : !packages.has(id)
          ? "Package body missing; HTML-only processing possible"
          : null,
  }));
  return {
    products,
    report: {
      entries: entries.length,
      uniqueActivityIds: ids.length,
      completePairs: products.filter((p) => !p.held && p.html && p.packages)
        .length,
      conflicts: [...conflicts],
      duplicates,
      ignored,
      missingBodies,
      issues,
      networkRequests: 0,
      publicationApproved: false,
      privacy:
        "No request headers/cookies/postData exported; inert document metadata and allowlisted package fields only. Raw HAR remains private; response text/JSON-LD is not a universal personal-data sanitizer.",
    },
  };
}

export const harDigest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
