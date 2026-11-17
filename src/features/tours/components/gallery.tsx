"use client";
import { useRef, useState } from "react";
import { TourPhoto as Image } from "./photo";
import { X, ChevronLeft, ChevronRight, Images } from "lucide-react";
import type { Locale } from "@/lib/catalog";
import type { Tour } from "../model";
import { tourLabels } from "../labels";
export function TourGallery({
  images,
  locale,
  fallbackImage,
}: {
  images: Tour["images"];
  locale: Locale;
  fallbackImage?: { src: string; alt: string; label: string };
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(0);
  const t = tourLabels[locale];
  if (!images.length) return null;
  const open = (index: number) => {
    setActive(index);
    dialog.current?.showModal();
  };
  return (
    <>
      <div
        className={`tour-gallery ${images.length === 1 ? "single-image" : ""}`}
      >
        {images.slice(0, 3).map((image, i) => (
          <button
            key={`${image.url}-${i}`}
            type="button"
            onClick={() => open(i)}
            aria-label={`${t.enlarge}: ${image.alt[locale]}`}
          >
            <Image
              resolution="detail"
              fallbackImage={fallbackImage}
              unoptimized={
                image.url.startsWith("https://cdn.getyourguide.com/") ||
                image.url.startsWith("/images/admin/") ||
                image.url.startsWith("/admin/api/images/")
              }
              src={image.url}
              alt={image.alt[locale]}
              fill
              priority={i === 0}
              sizes={i === 0 ? "(max-width:750px) 100vw, 65vw" : "35vw"}
            />
            {i === 0 && (
              <span>
                <Images size={16} />
                {t.gallery} · {images.length}
              </span>
            )}
          </button>
        ))}
      </div>
      <dialog
        className="gallery-dialog"
        ref={dialog}
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setActive((active + 1) % images.length);
          if (e.key === "ArrowLeft")
            setActive((active + images.length - 1) % images.length);
        }}
        aria-label={t.gallery}
      >
        <button
          className="gallery-close"
          onClick={() => dialog.current?.close()}
          aria-label={t.close}
        >
          <X />
        </button>
        <div className="gallery-stage">
          <Image
            resolution="lightbox"
            fallbackImage={fallbackImage}
            unoptimized={
              images[active].url.startsWith("https://cdn.getyourguide.com/") ||
              images[active].url.startsWith("/images/admin/") ||
              images[active].url.startsWith("/admin/api/images/")
            }
            src={images[active].url}
            alt={images[active].alt[locale]}
            fill
            sizes="90vw"
          />
        </div>
        <div className="gallery-controls">
          <button
            onClick={() =>
              setActive((active + images.length - 1) % images.length)
            }
            aria-label={t.previous}
          >
            <ChevronLeft />
          </button>
          <p>
            {images[active].alt[locale]} · {active + 1} / {images.length}
          </p>
          <button
            onClick={() => setActive((active + 1) % images.length)}
            aria-label={t.next}
          >
            <ChevronRight />
          </button>
        </div>
      </dialog>
    </>
  );
}
