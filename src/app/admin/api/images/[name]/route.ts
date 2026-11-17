import { requireAdmin } from "@/features/admin/server";
import { imageName, localImage } from "@/features/admin/media";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  try {
    const p = await requireAdmin();
    if (p.mode !== "local") throw new Error();
    const { name } = await params;
    if (!imageName.test(name)) throw new Error();
    return new Response(new Uint8Array(await localImage(name)), {
      headers: {
        "Content-Type": name.endsWith(".jpg")
          ? "image/jpeg"
          : name.endsWith(".png")
            ? "image/png"
            : "image/webp",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'} });
  }
}
