import { nativeSelected } from "@/features/ingestion/native-config";
import { postgresFor } from "@/features/ingestion/runtime";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("check") !== "ready")
    return Response.json(
      { status: "alive" },
      { headers: { "Cache-Control": "no-store" } },
    );
  try {
    if (!nativeSelected()) throw new Error();
    await (
      await postgresFor("asia_catalog_reader")
    ).query("select id from catalog_projection.documents limit 1");
    await (
      await postgresFor("asia_catalog_editor")
    ).query("select id from catalog_projection.inquiries limit 1");
    return Response.json(
      { status: "ready" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "not_ready" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
