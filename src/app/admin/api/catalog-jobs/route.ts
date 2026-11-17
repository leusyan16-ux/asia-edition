import { z } from "zod";
import { requireAdmin, adminTaxonomy } from "@/features/admin/server";
import { requireLocalCatalog } from "@/features/tours/local-repository";
import { assertOrigin, AccessDenied } from "@/features/admin/security";
import { limitedJSON } from "@/features/admin/http";
import { readLocalState } from "@/features/admin/local-store";
import { postgresSelected } from "@/features/ingestion/config";
import {
  stageCatalogJob,
  advanceCatalogJob,
  cancelCatalogJob,
  reviewExternalProduct,
} from "@/features/admin/catalog-jobs";
export const dynamic = "force-dynamic";
async function access() {
  if (postgresSelected()) throw new AccessDenied();
  const p = await requireAdmin();
  if (p.mode !== "local") throw new AccessDenied();
  await requireLocalCatalog();
  return p;
}
export async function GET() {
  try {
    await access();
    const state = await readLocalState();
    return Response.json(
      {
        jobs: (state.catalogJobs || []).map(
          ({ mapping, identities, parts, ...job }) => ({
            ...job,
            packet_count: parts.length,
            mapping_count: mapping.length,
            identity_count: identities.length,
          }),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Требуется локальный администратор" },
      { status: 403 },
    );
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const p = await access();
    const raw = await limitedJSON(request, 110 * 1024 * 1024);
    const input = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("stage"),
            format: z.enum(["csv", "json"]),
            content: z.string(),
            scope: z.unknown(),
          })
          .strict(),
        z
          .object({
            action: z.literal("advance"),
            id: z.uuid(),
            cursor: z.number().int().nonnegative(),
          })
          .strict(),
        z.object({ action: z.literal("cancel"), id: z.uuid() }).strict(),
        z
          .object({
            action: z.literal("review"),
            id: z.uuid(),
            review: z.unknown(),
          })
          .strict(),
      ])
      .parse(raw);
    const taxonomy = await adminTaxonomy(p);
    if (input.action === "stage") {
      const result = await stageCatalogJob(
        input.content,
        input.format,
        input.scope,
        taxonomy,
        p.id,
      );
      return Response.json({
        job: result.job
          ? {
              id: result.job.id,
              cursor: 0,
              phase: result.job.phase,
              total: result.job.total,
            }
          : null,
        summary: result.summary,
        errors: result.errors,
      });
    }
    if (input.action === "review") {
      await reviewExternalProduct(input.id, input.review);
      return Response.json({ ok: true });
    }
    const job =
      input.action === "cancel"
        ? await cancelCatalogJob(input.id)
        : await advanceCatalogJob(input.id, input.cursor, taxonomy);
    return Response.json({
      job: {
        id: job.id,
        phase: job.phase,
        cursor: job.cursor,
        total: job.total,
        processed: job.processed,
        created: job.created,
        updated: job.updated,
        skipped: job.skipped,
        missing: job.missing,
        discontinued: job.discontinued,
        errors: job.errors,
      },
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Не удалось обработать feed" },
      { status: e instanceof AccessDenied ? 403 : 400 },
    );
  }
}
