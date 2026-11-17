import { z } from "zod";
import { requireAdmin, saveTours } from "@/features/admin/server";
import { assertOrigin } from "@/features/admin/security";
import { limitedJSON, adminError } from "@/features/admin/http";
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const p = await requireAdmin();
    const body = z
      .object({
        tours: z.array(z.unknown()).max(1000),
        expected: z.record(z.string(), z.string()),
      })
      .parse(await limitedJSON(request, 4 * 1024 * 1024));
    const tours = await saveTours(p, body.tours, body.expected);
    return Response.json(
      { tours },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return adminError(e);
  }
}
