import { requireAdmin } from "@/features/admin/server";
import { assertOrigin } from "@/features/admin/security";
import { uploadImage, deleteImage } from "@/features/admin/media";
import { limitedBody, limitedJSON, adminError } from "@/features/admin/http";
import { postgresSelected } from "@/features/ingestion/config";
import { postgresFor } from "@/features/ingestion/runtime";
import { reviewGalleryMedia } from "@/features/ingestion/media-review";
export async function PATCH(request: Request) {
  try {
    assertOrigin(request);
    await requireAdmin();
    if (!postgresSelected())
      throw new Error("Проверка фотографий доступна в PostgreSQL-режиме");
    const input = await limitedJSON(request, 4096);
    await reviewGalleryMedia(await postgresFor("asia_catalog_editor"), input);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return adminError(error);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const p = await requireAdmin();
    const body = await limitedBody(request, 9 * 1024 * 1024);
    const form = await new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") || "" },
      body: body as BodyInit,
    }).formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw new Error("Выберите изображение");
    return Response.json({ url: await uploadImage(p, file) });
  } catch (e) {
    return adminError(e);
  }
}
export async function DELETE(request: Request) {
  try {
    assertOrigin(request);
    const p = await requireAdmin();
    const { url } = await limitedJSON(request, 4096);
    if (typeof url !== "string" || url.length > 2048)
      throw new Error("Недопустимый адрес");
    await deleteImage(p, url);
    return Response.json({ ok: true });
  } catch (e) {
    return adminError(e);
  }
}
