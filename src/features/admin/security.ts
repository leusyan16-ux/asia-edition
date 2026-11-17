import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export type LocalIdentity = {
  email: string;
  salt: string;
  hash: string;
  secret: string;
};
export type Principal = {
  id: string;
  role: "admin";
  mode: "local" | "supabase";
  token?: string;
};
export function configuredAdminMode(
  mode: string | undefined,
  nodeEnv: string | undefined,
) {
  return mode === "supabase"
    ? "supabase"
    : mode === "local" && nodeEnv !== "production"
      ? "local"
      : "disabled";
}
export function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}
export function createIdentity(email: string, password: string): LocalIdentity {
  if (password.length < 12)
    throw new Error("Пароль должен содержать не менее 12 символов");
  const salt = randomBytes(24).toString("hex");
  return {
    email,
    salt,
    hash: hashPassword(password, salt),
    secret: randomBytes(48).toString("hex"),
  };
}
export function passwordMatches(password: string, identity: LocalIdentity) {
  const actual = Buffer.from(hashPassword(password, identity.salt), "hex"),
    expected = Buffer.from(identity.hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function signSession(identity: LocalIdentity, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: identity.email,
      exp: now + 3600000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", identity.secret).update(payload).digest("base64url")}`;
}
export function verifySession(
  token: string,
  identity: LocalIdentity,
  now = Date.now(),
): Principal | null {
  try {
    const [payload, signature, ...extra] = token.split(".");
    if (extra.length || !payload || !signature) return null;
    const expected = createHmac("sha256", identity.secret)
      .update(payload)
      .digest();
    const supplied = Buffer.from(signature, "base64url");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.sub === identity.email &&
      Number.isFinite(data.exp) &&
      data.exp > now &&
      data.exp <= now + 3600000
      ? { id: data.sub, role: "admin", mode: "local" }
      : null;
  } catch {
    return null;
  }
}
export class AccessDenied extends Error {
  constructor() {
    super("Доступ разрешён только администратору");
  }
}
export function authorize(
  principal: Principal | null,
): asserts principal is Principal {
  if (!principal || principal.role !== "admin") throw new AccessDenied();
}
export function isLoopback(host: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(`http://${host}`).hostname,
    );
  } catch {
    return false;
  }
}
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") || new URL(request.url).host;
  const configured =
    process.env.NODE_ENV === "production"
      ? process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
      : undefined;
  try {
    if (process.env.NODE_ENV === "production" && !configured) throw new Error();
    const parsed = new URL(origin || "");
    if (
      configured
        ? parsed.origin !== new URL(configured).origin
        : parsed.host !== host || !["http:", "https:"].includes(parsed.protocol)
    )
      throw new Error();
  } catch {
    throw new Error("Недопустимый источник запроса");
  }
}
