import { mergeCart, type CartLine } from "./model";

export const guestCartKey = "asia-edition-guest-cart-v1";
export type CartStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type CartAPI = (path: string, body?: unknown) => Promise<unknown>;

export function readGuestCart(storage: CartStorage): CartLine[] {
  return mergeCart([], JSON.parse(storage.getItem(guestCartKey) ?? "[]"));
}

/** Never discard a local line until the server acknowledges the revision-checked merge. */
export async function syncGuestCart(api: CartAPI, storage: CartStorage) {
  const guest = readGuestCart(storage);
  const server = (await api("cart")) as {
    items: CartLine[];
    revision: number;
  } | null;
  if (!guest.length) return server;
  await api("cart", { items: guest, revision: server?.revision ?? 0 });
  // Preserve additions made in another tab while this request was in flight.
  const remaining = readGuestCart(storage).filter(
    (line) =>
      !guest.some((saved) => JSON.stringify(saved) === JSON.stringify(line)),
  );
  if (remaining.length)
    storage.setItem(guestCartKey, JSON.stringify(remaining));
  else storage.removeItem(guestCartKey);
  return (await api("cart")) as { items: CartLine[]; revision: number } | null;
}
