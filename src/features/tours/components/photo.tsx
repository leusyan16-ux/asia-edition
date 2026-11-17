"use client";
import Image, { type ImageProps } from "next/image";
import { tourImageVariant } from "../image-variants";
import { useState } from "react";
import { MapPin } from "lucide-react";

/** Keep cards usable if a supplier later withdraws an externally hosted image. */
export function TourPhoto({
  resolution = "card",
  fallbackImage,
  contextLabel,
  ...props
}: ImageProps & {
  resolution?: "card" | "detail" | "lightbox";
  fallbackImage?: { src: string; alt: string; label: string };
  contextLabel?: string;
}) {
  const [fallbackSource, setFallbackSource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [failedContext, setFailedContext] = useState<string | null>(null);
  const source = String(props.src);
  if (failedSource === source && fallbackImage && failedContext !== source)
    return (
      <>
        <Image
          {...props}
          src={fallbackImage.src}
          alt={fallbackImage.alt}
          onError={() => setFailedContext(source)}
        />
        <span className="photo-context-label">{fallbackImage.label}</span>
      </>
    );
  if (failedSource === source)
    return (
      <span className="tour-card-placeholder" role="img" aria-label={props.alt}>
        <MapPin aria-hidden="true" size={32} />
      </span>
    );
  const display =
    fallbackSource === source
      ? source
      : tourImageVariant(
          source,
          resolution === "card" ? 800 : resolution === "detail" ? 1600 : 2000,
        );
  const mobile = display !== source && resolution !== "lightbox"
    ? tourImageVariant(source, resolution === "card" ? 480 : 1000)
    : display;
  const photo = (
    <Image
      {...props}
      priority={mobile === display ? props.priority : undefined}
      fetchPriority={mobile !== display && props.priority ? "high" : props.fetchPriority}
      loading={mobile !== display && props.priority ? "eager" : props.loading}
      src={display}
      alt={props.alt}
      onError={() => {
        if (display !== source) setFallbackSource(source);
        else setFailedSource(source);
      }}
    />
  );
  return (
    <>
      {mobile === display ? photo : (
        <picture className={props.fill ? "tour-photo-picture" : undefined}>
          <source media="(max-width: 600px) and (max-resolution: 2dppx)" srcSet={mobile} />
          {photo}
        </picture>
      )}
      {contextLabel && (
        <span className="photo-context-label">{contextLabel}</span>
      )}
    </>
  );
}
