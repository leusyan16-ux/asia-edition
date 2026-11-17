import type { AdminTour } from "@/features/admin/model";
import { isLoopback } from "@/features/admin/security";
import { tourSchema, type Tour } from "./model";
import { isAllowedTour } from "@/lib/geography";
export function localCatalogAllowed(
  environment: string | undefined,
  adminMode: string | undefined,
  source: string | undefined,
  host: string,
) {
  return (
    environment === "development" &&
    adminMode === "local" &&
    source === "local" &&
    isLoopback(host)
  );
}
export function isPublicLocalTour(tour: AdminTour) {
  return tour.status === "published" && tour.visible && !tour.archived && isAllowedTour(tour);
}
export function localTourPayload(
  tour: AdminTour,
  preview = false,
  today = new Date().toISOString().slice(0, 10),
): Tour {
  const payload = tourSchema.parse({
    ...tour,
    images: tour.images,
    prices: preview
      ? tour.prices
      : tour.prices.filter(
          (p) =>
            p.verifiedAt &&
            (!p.validFrom || p.validFrom <= today) &&
            (!p.validUntil || p.validUntil >= today),
        ),
    availability: preview
      ? []
      : [
          ...new Set(
            tour.slots
              .filter((s) => s.verifiedAt && s.date >= today)
              .map((s) => s.date),
          ),
        ]
          .sort()
          .map((date) => {
            const slots = tour.slots.filter(
              (s) => s.date === date && s.verifiedAt,
            );
            const remaining = Math.max(
              0,
              ...slots
                .filter((s) => s.status === "available")
                .map((s) => s.capacity - s.reserved),
            );
            return {
              date,
              remaining,
              status:
                remaining > 0
                  ? "available"
                  : slots.some((s) => s.status === "sold_out")
                    ? "sold_out"
                    : "closed",
            };
          }),
  });
  return {
    ...payload,
    images: payload.images.map((image) => ({
      ...image,
      url:
        preview && image.url.startsWith("/images/admin/")
          ? `/admin/api/images/${image.url.split("/").pop()}`
          : image.url,
    })),
  };
}
