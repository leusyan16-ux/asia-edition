import sharp from "sharp";
export function imageType(bytes: Uint8Array): "jpg" | "png" | "webp" {
  const b = Buffer.from(bytes);
  if (b.length >= 12 && b[0] === 255 && b[1] === 216 && b[2] === 255)
    return "jpg";
  if (
    b.length >= 12 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (
    b.length >= 12 &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  throw new Error("Разрешены только JPEG, PNG и WebP");
}
export async function sanitizeImage(bytes: Uint8Array) {
  imageType(bytes);
  try {
    return await sharp(bytes, { limitInputPixels: 40000000, animated: false })
      .rotate()
      .resize({
        width: 2400,
        height: 2400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 88 })
      .toBuffer();
  } catch {
    throw new Error(
      "Изображение повреждено или слишком большое (до 40 млн пикселей)",
    );
  }
}
