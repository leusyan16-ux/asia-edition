import { requireAdmin, adminPostgresJobs } from "@/features/admin/server";
import { assertOrigin } from "@/features/admin/security";
import { adminError, limitedJSON } from "@/features/admin/http";
import { postgresFor } from "@/features/ingestion/runtime";
import { z } from "zod";
export async function GET() {
  try {
    const p = await requireAdmin();
    return Response.json(await adminPostgresJobs(p), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return adminError(e);
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const p = await requireAdmin();
    const body = await limitedJSON(request, 4096);
    if (body?.action === "publish") {
      const input = z
        .object({
          action: z.literal("publish"),
          id: z.uuid(),
          expected: z.string().max(80),
          confirmation: z.literal("ПУБЛИКОВАТЬ"),
        })
        .strict()
        .parse(body);
      await (
        await postgresFor("asia_catalog_editor")
      ).query("select catalog_projection.authorize_publication($1,$2,$3)", [
        input.id,
        input.expected,
        p.id,
      ]);
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const input = z
      .object({
        action: z.literal("review"),
        id: z.uuid(),
        expected: z.string().max(80),
        editorial: z.enum(["pending", "approved", "rejected"]),
        rights: z.enum(["unknown", "licensed", "restricted"]),
        evidence: z.url().startsWith("https://").max(2048).nullable(),
      })
      .strict()
      .parse(body);
    await (
      await postgresFor("asia_catalog_editor")
    ).query("select catalog_projection.review($1,$2,$3,$4,$5,$6)", [
      input.id,
      input.expected,
      input.editorial,
      input.rights,
      input.evidence,
      p.id,
    ]);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return adminError(e);
  }
}
