"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GalleryMediaReview } from "./media-review";

export function MediaReviewPanel({
  product,
  images,
  assets,
}: {
  product: string;
  images: { url: string }[];
  assets: GalleryMediaReview[];
}) {
  if (!assets.length) return null;
  return (
    <section className="admin-section">
      <h2>Права на фотографии</h2>
      <p>
        Сначала сохраните галерею. Подтвердите права отдельно на каждую
        загруженную фотографию. Изменение проверки снимает связанные карточки с
        публикации; повторная проверка не публикует их автоматически.
      </p>
      {assets.map((asset) => (
        <MediaReviewForm
          key={`${asset.key}:${asset.content_rights_status}:${asset.rights_evidence}`}
          product={product}
          asset={asset}
          number={
            images.findIndex(
              (image) => image.url === `/images/admin/${asset.key}`,
            ) + 1
          }
        />
      ))}
    </section>
  );
}
function MediaReviewForm({
  product,
  asset,
  number,
}: {
  product: string;
  asset: GalleryMediaReview;
  number: number;
}) {
  const router = useRouter();
  const [rights, setRights] = useState(asset.content_rights_status),
    [evidence, setEvidence] = useState(asset.rights_evidence ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        setSaved(false);
        try {
          if (
            document
              .querySelector(".admin-editor")
              ?.getAttribute("data-dirty") === "true"
          )
            throw new Error("Сначала сохраните изменения карточки");
          const response = await fetch("/admin/api/images", {
            method: "PATCH",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              product,
              key: asset.key,
              rights,
              evidence: evidence.trim() || null,
            }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Не удалось сохранить проверку");
          setSaved(true);
          router.refresh();
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось сохранить проверку",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Фото {number || asset.key}</h3>
      <div className="admin-fields">
        <label>
          Права на фотографию
          <select
            value={rights}
            onChange={(e) => {
              setRights(
                e.target.value as GalleryMediaReview["content_rights_status"],
              );
              setSaved(false);
            }}
            disabled={busy}
          >
            <option value="unknown">Не подтверждены</option>
            <option value="licensed">Подтверждены</option>
            <option value="restricted">Ограничены</option>
          </select>
        </label>
        <label>
          Документ о правах (HTTPS)
          <input
            type="url"
            required={rights === "licensed"}
            maxLength={2048}
            value={evidence}
            onChange={(e) => {
              setEvidence(e.target.value);
              setSaved(false);
            }}
            disabled={busy}
            placeholder="https://"
          />
        </label>
      </div>
      <button className="admin-primary" disabled={busy}>
        {busy ? "Сохранение…" : "Сохранить права на фото"}
      </button>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {saved && (
        <p role="status">Проверка сохранена. Публикация не выполнялась.</p>
      )}
    </form>
  );
}
