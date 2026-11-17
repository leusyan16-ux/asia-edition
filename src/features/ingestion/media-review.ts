/** Server-only gallery operations; HTTP callers must first requireAdmin(). */
import { z } from "zod";
import { mediaKey } from "./media";
import type { SQL } from "./postgres-worker";

export const mediaReviewSchema = z
  .object({
    product: z.uuid(),
    key: z.string().regex(mediaKey),
    rights: z.enum(["unknown", "licensed", "restricted"]),
    evidence: z.url().startsWith("https://").max(2048).nullable(),
  })
  .strict()
  .refine((v) => v.rights !== "licensed" || v.evidence !== null, {
    message: "Укажите HTTPS-документ, подтверждающий права на фотографию",
    path: ["evidence"],
  });
export type GalleryMediaReview = {
  key: string;
  content_rights_status: "unknown" | "licensed" | "restricted";
  rights_evidence: string | null;
};
export async function galleryMediaReviews(db: SQL, product: string) {
  z.uuid().parse(product);
  return (
    await db.query<GalleryMediaReview>(
      "select a.key,a.content_rights_status,a.rights_evidence from catalog_projection.media_assets a join catalog_projection.media_links l on l.asset_id=a.id where l.product_id=$1 and l.active and a.retired_at is null order by a.key limit 40",
      [product],
    )
  ).rows;
}
export async function reviewGalleryMedia(db: SQL, input: unknown) {
  const value = mediaReviewSchema.parse(input);
  const linked = await db.query(
    "select a.id from catalog_projection.media_assets a join catalog_projection.media_links l on l.asset_id=a.id where l.product_id=$1 and a.key=$2 and l.active and a.retired_at is null",
    [value.product, value.key],
  );
  if (!linked.rows.length)
    throw new Error(
      "Сначала сохраните карточку с этой фотографией и обновите страницу",
    );
  await db.query("select catalog_projection.review_media($1,$2,$3)", [
    value.key,
    value.rights,
    value.evidence,
  ]);
}
