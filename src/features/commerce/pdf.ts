import { statusLabel } from "./model";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function requestPDF(
  payload: Record<string, unknown>,
  kind: string,
  locale: "ru" | "en",
) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Full static OFL font plus disabled contextual alternates avoids broken Cyrillic and ToUnicode mappings.
  const font = await pdf.embedFont(
    await readFile(
      path.join(process.cwd(), "public/fonts/cormorant-pdf-regular.ttf"),
    ),
    {
      subset: false,
      features: { liga: false, clig: false, kern: false, calt: false },
    },
  );
  const ru = locale === "ru";
  let page = pdf.addPage([595, 842]),
    y = 790;
  const line = (text: string, size = 14) => {
    const words = text
      .replace(/[\r\n]+/g, " ")
      .split(/\s+/)
      .flatMap((word) => {
        const parts: string[] = [];
        let part = "";
        for (const character of word) {
          if (font.widthOfTextAtSize(part + character, size) > 485 && part) {
            parts.push(part);
            part = "";
          }
          part += character;
        }
        if (part) parts.push(part);
        return parts;
      });
    let current = "";
    for (const word of words) {
      const candidate = current ? current + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) > 485 && current) {
        draw(current, size);
        current = word;
      } else current = candidate;
    }
    if (current) draw(current, size);
  };
  const draw = (text: string, size: number) => {
    if (y < 55) {
      page = pdf.addPage([595, 842]);
      y = 790;
    }
    page.drawText(text, { x: 55, y, size, font, color: rgb(0.08, 0.21, 0.17) });
    y -= size * 1.6;
  };
  line("ASIA EDITION", 24);
  line(
    kind === "voucher"
      ? ru
        ? "Ваучер подтверждённого бронирования"
        : "Confirmed booking voucher"
      : ru
        ? "Заявка на бронирование получена"
        : "Booking request received",
    20,
  );
  if (kind !== "voucher")
    line(
      ru
        ? "Этот документ подтверждает получение заявки. Бронирование и оплата не подтверждены."
        : "This document acknowledges a request. No reservation or payment is confirmed.",
    );
  const order = (payload.order ?? {}) as Record<string, unknown>;
  if (order.number)
    line((ru ? "Номер заявки: " : "Request number: ") + String(order.number));
  if (order.created_at)
    line(
      (ru ? "Создано: " : "Created: ") + new Date(String(order.created_at)).toISOString() + " (UTC)",
    );
  const items = (Array.isArray(payload.items) ? payload.items : []) as Record<
    string,
    unknown
  >[];
  for (const item of items) {
    y -= 14;
    const title = item.title as Record<string, string>;
    line(title?.[locale] ?? "", 18);
    const destination = item.destination as Record<string, string>;
    if (destination?.[locale]) line(destination[locale]);
    line(
      (ru ? "Желаемая дата: " : "Requested date: ") +
        String(item.requested_date),
    );
    line(
      (ru ? "Участники: взрослые " : "Guests: adults ") +
        String(item.adults) +
        ", " +
        (ru ? "дети " : "children ") +
        String(item.children),
    );
    if (item.options) line(String(item.options));
    line(
      ru
        ? "Время и часовой пояс согласовываются при подтверждении."
        : "Time and time zone are arranged on confirmation.",
    );
    if (item.amount !== null && item.amount !== undefined)
      line(String(item.amount) + " " + String(item.currency));
  }
  if (payload.title)
    line(String((payload.title as Record<string, string>)[locale] ?? ""));
  if (payload.supplier_code)
    line(
      (ru ? "Код поставщика: " : "Supplier reference: ") +
        String(payload.supplier_code),
    );
  if (payload.status)
    line(
      (ru ? "Статус: " : "Status: ") +
        statusLabel(String(payload.status), locale),
    );
  const support = process.env.SUPPORT_EMAIL;
  if (support) line((ru ? "Поддержка: " : "Support: ") + support);
  if (payload.documentVersion)
    line(
      (ru ? "Версия документа: " : "Document version: ") +
        String(payload.documentVersion),
    );
  pdf.setTitle("ASIA EDITION");
  return pdf.save();
}
