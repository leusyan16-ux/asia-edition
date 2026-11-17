export class CommerceAPIError extends Error {
  constructor(
    public status: number,
    code: string,
  ) {
    super(code);
  }
}
let refreshing: Promise<boolean> | null = null;

/** One bounded refresh/retry; refresh credentials never enter JavaScript. */
export async function commerceAPI(path: string, body?: unknown) {
  const send = (name: string, payload?: unknown) =>
    fetch("/api/commerce/" + name, {
      method: payload === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers:
        payload === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      cache: "no-store",
    });
  let response = await send(path, body);
  if (
    response.status === 401 &&
    ![
      "login",
      "register",
      "reset",
      "resend",
      "refresh",
      "logout",
      "oauth",
      "callback",
    ].includes(path.split("?")[0])
  ) {
    if (!refreshing)
      refreshing = send("refresh", {})
        .then((r) => r.ok)
        .finally(() => {
          refreshing = null;
        });
    if (await refreshing) response = await send(path, body);
  }
  const data = await response.json();
  if (!response.ok)
    throw new CommerceAPIError(response.status, data.error ?? "unavailable");
  return data;
}
