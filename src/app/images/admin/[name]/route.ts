import { readLocalTours } from "@/features/admin/local-store";
import { imageName, localImage } from "@/features/admin/media";
import { isPublicLocalTour } from "@/features/tours/local-catalog";
import { requireLocalCatalog } from "@/features/tours/local-repository";
import { postgresSelected } from "@/features/ingestion/config";
import { postgresFor } from "@/features/ingestion/runtime";
import { readMedia } from "@/features/ingestion/media";
import { postgresMediaStore } from "@/features/admin/media";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    await requireLocalCatalog();
    const { name } = await params;
    if (!imageName.test(name)) throw new Error();
    if (
      !postgresSelected() &&
      !(await readLocalTours()).some(
        (t) =>
          isPublicLocalTour(t) &&
          t.images.some((i) => i.url === `/images/admin/${name}`),
      )
    )
      throw new Error();
    const image = postgresSelected()
      ? await readMedia(
          await postgresFor("asia_catalog_reader"),
          postgresMediaStore(),
          name,
          true,
        )
      : await localImage(name);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": name.endsWith(".jpg")
          ? "image/jpeg"
          : name.endsWith(".png")
            ? "image/png"
            : "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
