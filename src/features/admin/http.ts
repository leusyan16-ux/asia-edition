import { AccessDenied } from "./security";
import { validationError } from "./errors";
export async function limitedBody(
  request: Request,
  limit: number,
): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("Запрос превышает допустимый размер");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function limitedJSON(request: Request, limit: number) {
  return JSON.parse(
    new TextDecoder().decode(await limitedBody(request, limit)),
  );
}
export function adminError(error: unknown) {
  return Response.json(
    {
      error: validationError(error),
    },
    {
      status: error instanceof AccessDenied ? 403 : 400,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
