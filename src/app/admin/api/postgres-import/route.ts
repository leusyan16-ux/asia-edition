import { z } from "zod";
import {
  externalCSVTemplate,
  externalJSONTemplate,
} from "@/features/admin/import-engine";
import { requireAdmin, adminTaxonomy } from "@/features/admin/server";
import { assertOrigin } from "@/features/admin/security";
import { limitedBody, limitedJSON, adminError } from "@/features/admin/http";
import { postgresFor } from "@/features/ingestion/runtime";
import {
  prepareUpload,
  releaseUpload,
  stepUpload,
  uploadJob,
  UPLOAD_LIMITS,
} from "@/features/ingestion/upload";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const db = await postgresFor("asia_catalog_editor"),
      id = new URL(request.url).searchParams.get("id");
    const template = new URL(request.url).searchParams.get("template");
    if (template === "csv" || template === "json")
      return new Response(
        template === "csv" ? externalCSVTemplate : externalJSONTemplate,
        {
          headers: {
            "Content-Type":
              template === "csv"
                ? "text/csv; charset=utf-8"
                : "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="asia-edition-template.${template}"`,
            "Cache-Control": "private, no-store",
          },
        },
      );
    if (id)
      return Response.json(
        { job: await uploadJob(db, id) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const rows = await db.query(
      "select u.id,u.filename,u.job_id,u.state,u.created_at,u.preview-'rows'-'errors' as summary,j.cursor,j.parts,j.state job_state,j.last_error from catalog_ingest.uploads u left join catalog_ingest.jobs j on j.id=u.job_id order by u.created_at desc limit 20",
    );
    return Response.json(
      { uploads: rows.rows },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return adminError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const p = await requireAdmin(),
      db = await postgresFor("asia_catalog_worker"),
      taxonomy = await adminTaxonomy(p),
      test = /^(test|qa)-/.test(process.env.POSTGRES_LOCAL_PROFILE ?? "");
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const body = await limitedBody(
        request,
        UPLOAD_LIMITS.maxBytes + 1024 * 1024,
      );
      const form = await new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": request.headers.get("content-type")! },
        body: body as BodyInit,
      }).formData();
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        !file.size ||
        file.size > UPLOAD_LIMITS.maxBytes
      )
        throw new Error("Выберите CSV или JSON до 8 МБ");
      const format = file.name.toLowerCase().endsWith(".csv")
        ? "csv"
        : file.name.toLowerCase().endsWith(".json")
          ? "json"
          : null;
      if (!format) throw new Error("Разрешены только файлы .csv и .json");
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.arrayBuffer(),
        );
      } catch {
        throw new Error(
          "Не удалось прочитать файл. Сохраните его в кодировке UTF-8",
        );
      }
      return Response.json(
        await prepareUpload(
          db,
          content,
          format,
          file.name,
          taxonomy,
          p.id,
          test,
        ),
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const input = z
      .object({
        action: z.enum(["release", "step", "cancel"]),
        id: z.uuid(),
        cursor: z.number().int().min(0).max(4000).optional(),
      })
      .strict()
      .parse(await limitedJSON(request, 4096));
    if (input.action === "release") await releaseUpload(db, input.id);
    else if (input.action === "cancel")
      await db.query(
        "update catalog_ingest.jobs set state='cancelled',owner=null,lease_until=null where id=$1 and state<>'completed'",
        [input.id],
      );
    else {
      if (input.cursor === undefined)
        throw new Error("Нужна контрольная точка");
      return Response.json(
        { job: await stepUpload(db, input.id, input.cursor, taxonomy, test) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { job: await uploadJob(db, input.id) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return adminError(e);
  }
}
