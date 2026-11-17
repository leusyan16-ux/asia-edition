import { NextResponse, type NextRequest } from "next/server";
import { previewRoute } from "./lib/public-preview";

export function proxy(request: NextRequest) {
  const mode = previewRoute(
    request.nextUrl.pathname,
    request.method,
    request.nextUrl.search,
  );
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
  };
  if (mode === "health")
    return NextResponse.json({ status: "alive" }, { headers });
  if (mode === "blocked")
    return new NextResponse(null, { status: 404, headers });
  return NextResponse.next();
}
export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/images/admin/:path*"],
};
