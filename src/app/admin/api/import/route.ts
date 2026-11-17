import { z } from "zod";
import {
  requireAdmin,
  adminTaxonomy,
  adminOverview,
  saveTours,
} from "@/features/admin/server";
import { assertOrigin } from "@/features/admin/security";
import { previewCSV, csvTemplate } from "@/features/admin/csv";
import { readLocalState, localDirectory } from "@/features/admin/local-store";
import {
  externalCSVTemplate,
  externalJSONTemplate,
  prepareImport,
  previewDigest,
  commitExternalImport,
  isTestProfile,
  summary,
  recordImportErrors,
  IMPORT_BATCH_SIZE,
} from "@/features/admin/import-engine";
import { limitedJSON, adminError } from "@/features/admin/http";
import { postgresSelected } from "@/features/ingestion/config";
export async function GET(request: Request) {
  try {
    const p = await requireAdmin();
    if (postgresSelected())
      throw new Error(
        "Для PostgreSQL используйте отдельный журнал /admin/import",
      );
    const query = new URL(request.url).searchParams;
    if (query.get("history") === "1") {
      if (p.mode !== "local") throw new Error();
      const state = await readLocalState();
      return Response.json(
        { logs: state.imports.slice(-50).reverse() },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    if (query.get("kind") === "external") {
      const json = query.get("format") === "json";
      return new Response(json ? externalJSONTemplate : externalCSVTemplate, {
        headers: {
          "Content-Type": json
            ? "application/json; charset=utf-8"
            : "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="asia-edition-external.${json ? "json" : "csv"}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(csvTemplate, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="asia-edition-tours.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Требуется администратор" }, { status: 403 });
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const p = await requireAdmin();
    if (postgresSelected())
      throw new Error(
        "JSON importer отключён в PostgreSQL: запись в старое хранилище запрещена",
      );
    const body = await limitedJSON(request, 24 * 1024 * 1024);
    if (body && typeof body === "object" && "format" in body) {
      if (p.mode !== "local" || process.env.NODE_ENV !== "development")
        throw new Error(
          "Внешний CSV/JSON импорт сейчас доступен в локальной разработке. Supabase не изменяется.",
        );
      const input = z
        .object({
          format: z.enum(["csv", "json"]),
          content: z.string(),
          commit: z.boolean(),
          offset: z.number().int().min(0).max(4999).default(0),
          limit: z.number().int().min(1).max(5000).default(5000),
          batch_id: z.string().min(1).max(100).optional(),
          preview_digest: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict()
        .parse(body);
      const [taxonomy, state] = await Promise.all([
        adminTaxonomy(p),
        readLocalState(),
      ]);
      if (input.commit) {
        if (
          input.limit > IMPORT_BATCH_SIZE ||
          !input.batch_id ||
          !input.preview_digest
        )
          throw new Error(
            "Проверьте пакет до сохранения; максимум 250 продуктов",
          );
        const log = await commitExternalImport(
          {
            ...input,
            batch_id: input.batch_id,
            preview_digest: input.preview_digest,
          },
          taxonomy,
          p.id,
        );
        return Response.json(
          { log },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      }
      let rows;
      try {
        rows = prepareImport(
          input.content,
          input.format,
          taxonomy,
          state.tours,
          isTestProfile(localDirectory()),
        );
      } catch (e) {
        await recordImportErrors(input.content, input.format, p.id, [
          {
            row: 0,
            key: "file",
            errors: [
              e instanceof SyntaxError
                ? "Некорректный JSON-файл"
                : (e as Error).message,
            ],
          },
        ]);
        throw new Error(
          e instanceof SyntaxError
            ? "Некорректный JSON-файл"
            : (e as Error).message,
        );
      }
      const failedRows = rows.filter((r) => r.errors.length);
      if (failedRows.length)
        await recordImportErrors(input.content, input.format, p.id, failedRows);
      return Response.json(
        {
          total: rows.length,
          summary: summary(rows),
          preview_digest: previewDigest(
            input.content,
            input.format,
            state.tours,
            input.offset,
            input.limit,
          ),
          rows: rows
            .slice(input.offset, input.offset + input.limit)
            .map(({ tour, ...row }) => ({
              row: row.row,
              key: row.key,
              slug: row.slug,
              title: row.title,
              action: row.action,
              errors: row.errors,
              status: row.action === "skip" ? null : tour ? "draft" : null,
            })),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const { csv, commit } = z
      .object({ csv: z.string(), commit: z.boolean() })
      .parse(body);
    const [taxonomy, tours] = await Promise.all([
      adminTaxonomy(p),
      adminOverview(p),
    ]);
    const rows = previewCSV(csv, taxonomy, tours);
    if (!rows.length) throw new Error("Добавьте хотя бы одну строку");
    if (commit) {
      if (rows.some((r) => r.errors.length))
        throw new Error("Исправьте все ошибки перед импортом");
      await saveTours(
        p,
        rows.map((r) => r.tour!),
        {},
      );
      return Response.json({ saved: rows.length });
    }
    return Response.json({
      rows: rows.map(({ tour, ...r }) => ({
        ...r,
        status: tour ? "draft" : null,
      })),
    });
  } catch (e) {
    return adminError(e);
  }
}
