import type { NextConfig } from "next";
const config: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  serverExternalPackages: ["@electric-sql/pglite"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingIncludes: {
    "/api/commerce/**": ["./public/fonts/cormorant-pdf-regular.ttf"],
  },
  outputFileTracingExcludes: {
    "/*": ["./.admin-local/**/*", "./.admin-postgres/**/*", "./qa/**/*"],
  },
  images: {
    // Request-protected local uploads must never enter the shared image optimizer cache.
    ...(process.env.PUBLIC_PREVIEW_ONLY === "true" ||
    ["local", "postgres"].includes(process.env.TOUR_DATA_SOURCE ?? "")
      ? { localPatterns: [{ pathname: "/images/*", search: "" }] }
      : {}),
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      {
        protocol: "https",
        hostname: "cdn.getyourguide.com",
        pathname: "/image/**",
      },
      ...(process.env.NEXT_PUBLIC_SUPABASE_URL
        ? [
            {
              protocol: "https" as const,
              hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
              pathname: "/storage/v1/object/public/tour-images/**",
            },
          ]
        : []),
    ],
  },
};
export default config;
