import type { MetadataRoute } from "next";
import { indexingEnabled, publicOrigin } from "@/lib/site-config";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  return indexingEnabled()
    ? {
        rules: {
          userAgent: "*",
          allow: "/",
          disallow: [
            "/admin",
            "/api/",
            "/images/admin/",
            "/ru/demo/",
            "/en/demo/",
          ],
        },
        sitemap: `${publicOrigin()}/sitemap.xml`,
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
