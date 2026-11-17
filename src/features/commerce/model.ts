import { z } from "zod";
/** PostgREST embeds a unique foreign-key relation as an object, not an array. */
export function relationArray<T>(value: T | T[] | null | undefined): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
export const roles = [
  "owner",
  "admin",
  "manager",
  "editor",
  "support",
  "customer",
] as const;
export type Role = (typeof roles)[number];
export const permissions = {
  owner: [
    "orders:read",
    "orders:manage",
    "staff:manage",
    "catalog:edit",
    "support:read",
  ],
  admin: ["orders:read", "orders:manage", "catalog:edit", "support:read"],
  manager: ["orders:read", "orders:manage"],
  editor: ["catalog:edit"],
  support: ["orders:read", "support:read"],
  customer: [],
} as const;
export function permitted(role: Role, permission: string) {
  return (permissions[role] as readonly string[]).includes(permission);
}
export const cartLineSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,150}$/),
  date: z.iso.date(),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20),
  options: z.string().max(1000).default(""),
});
export const requestSchema = z.object({
  key: z.uuid(),
  locale: z.enum(["ru", "en"]),
  items: z.array(cartLineSchema).min(1).max(20),
  contact: z.object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40),
  }).optional(),
});
export type CartLine = z.infer<typeof cartLineSchema>;
export function mergeCart(a: CartLine[], b: CartLine[]) {
  return z
    .array(cartLineSchema)
    .max(20)
    .parse([
      ...new Map(
        [...a, ...b].map((i) => [
          JSON.stringify([i.slug, i.date, i.options]),
          i,
        ]),
      ).values(),
    ]);
}
export function validateRequestDates(lines: CartLine[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  for (const l of lines) {
    if (l.date < today || Date.parse(l.date) > now.getTime() + 730 * 86400000)
      throw Error("Invalid requested date");
  }
}
export type SupplierAdapter = {
  request: (input: unknown) => Promise<{
    status: "awaiting_supplier_confirmation";
    reference?: string;
  }>;
};
export type PaymentAdapter = {
  enabled: boolean;
  createCheckout: (orderId: string) => Promise<{ url: string; attemptId: string }>;
};
export const disabledPayments: PaymentAdapter = {
  enabled: false,
  async createCheckout() {
    throw Error("Payments disabled: no verified provider configured");
  },
};
export function statusLabel(status: string, locale: "ru" | "en") {
  const labels: Record<string, [string, string]> = {
    draft: ["Черновик", "Draft"],
    requested: ["Заявка получена", "Request received"],
    awaiting_availability: ["Проверяем доступность", "Checking availability"],
    awaiting_payment: ["Ожидается оплата", "Awaiting payment"],
    awaiting_supplier_confirmation: [
      "Ожидается поставщик",
      "Awaiting supplier",
    ],
    confirmed: ["Подтверждено", "Confirmed"],
    cancelled: ["Отменено", "Cancelled"],
    rejected: ["Отклонено", "Rejected"],
    completed: ["Завершено", "Completed"],
    unpaid: ["Не оплачено", "Unpaid"],
    pending: ["В обработке", "Pending"],
    paid: ["Оплачено", "Paid"],
    partially_refunded: ["Частичный возврат", "Partially refunded"],
    refunded: ["Возвращено", "Refunded"],
    failed: ["Ошибка", "Failed"],
  };
  return labels[status]?.[locale === "ru" ? 0 : 1] ?? status;
}

