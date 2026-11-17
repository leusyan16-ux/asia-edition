import { assertOrigin } from "@/features/admin/security";
import { limitedJSON } from "@/features/admin/http";
import {
  signChallenge,
  saveInquiry,
  inquirySchema,
} from "@/features/inquiries/model";
import { postgresFor } from "@/features/ingestion/runtime";
import { getTourRepository } from "@/features/tours/repository";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
function key() {
  if (
    process.env.INQUIRIES_ENABLED !== "true" ||
    process.env.TOUR_DATA_SOURCE !== "postgres"
  )
    throw new Error("Inquiries disabled");
  return process.env.INQUIRY_SIGNING_KEY ?? "";
}
export async function GET() {
  try {
    return Response.json({ token: signChallenge(key()) }, { headers });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }
}
export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const secret = key();
    const input = inquirySchema.parse(await limitedJSON(request, 8192));
    const tour = await getTourRepository().bySlug(input.product);
    if (!tour || tour.isDemo)
      return Response.json({ error: "unavailable" }, { status: 404, headers });
    const id = await saveInquiry(
      await postgresFor("asia_catalog_editor"),
      input,
      tour.id,
      secret,
    );
    return Response.json(
      {
        id,
        status: "request_received",
        bookingConfirmed: false,
        paymentTaken: false,
      },
      { status: 201, headers },
    );
  } catch {
    return Response.json(
      { error: "request_not_saved" },
      { status: 400, headers },
    );
  }
}
