import { requireAdmin } from "@/features/admin/server";
import { assertOrigin } from "@/features/admin/security";
import { limitedJSON } from "@/features/admin/http";
import { postgresFor } from "@/features/ingestion/runtime";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    await requireAdmin();
    const input = z
      .object({
        name: z.string().trim().min(1).max(200),
        evidence: z.url().startsWith("https://").max(2048),
        confirmation: z.literal(true),
      })
      .strict()
      .parse(await limitedJSON(request, 4096));
    const result = await (
      await postgresFor("asia_catalog_editor")
    ).query(
      "insert into public.operators(name,verified_at,external_reference) values($1,now(),$2) on conflict(external_reference) do update set name=excluded.name,verified_at=excluded.verified_at returning id",
      [input.name, input.evidence],
    );
    return Response.json(result.rows[0], {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "Не удалось сохранить проверенного оператора" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
