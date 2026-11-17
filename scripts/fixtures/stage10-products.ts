/** Isolated TEST fixtures only. Not seed inventory. */
export function syntheticProducts(
  count: number,
  stamp = "2026-10-19T00:00:00Z",
) {
  return Array.from({ length: count }, (_, n) => ({
    provider: "test_stage10",
    external_product_id: `TEST-${n}`,
    source_url: `https://example.invalid/TEST/${n}`,
    last_synced_at: stamp,
    import_status: "pending",
    test_data: true,
    product: {
      slug: `test-stage10-${n}`,
      country: "thailand",
      location: "chiang-mai",
      category: "culture",
      title: { ru: `ТЕСТ ${n}`, en: `TEST ${n}` },
    },
  }));
}
export function syntheticCSV(products: ReturnType<typeof syntheticProducts>) {
  const headers = [
    "provider",
    "external_product_id",
    "source_url",
    "import_status",
    "last_synced_at",
    "test_data",
    "slug",
    "country",
    "location",
    "category",
    "title_ru",
    "title_en",
  ];
  const quote = (value: unknown) =>
    '"' + String(value).replaceAll('"', '""') + '"';
  return (
    "\uFEFF" +
    headers.join(",") +
    "\r\n" +
    products
      .map((p) =>
        [
          p.provider,
          p.external_product_id,
          p.source_url,
          p.import_status,
          p.last_synced_at,
          p.test_data,
          p.product.slug,
          p.product.country,
          p.product.location,
          p.product.category,
          p.product.title.ru,
          p.product.title.en,
        ]
          .map(quote)
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
