import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { localDirectory } from "./local-store";
import { adminTours, supabaseClient } from "./server";
import { authorize, type Principal } from "./security";
import { sanitizeImage } from "./image-validation";
import { postgresSelected } from "../ingestion/config";
import { postgresDirectory } from "../ingestion/config";
import { postgresFor } from "../ingestion/runtime";
import { nativeSelected } from "../ingestion/native-config";
import { SupabasePrivateMediaStore } from "../ingestion/storage";
import {
  LocalMediaStore,
  uploadMedia,
  readMedia,
  retireMedia,
} from "../ingestion/media";
export const postgresMediaStore = () => {
  if (nativeSelected()) {
    if (process.env.PRIVATE_STORAGE_ENABLED !== "true")
      throw new Error("Private Storage disabled");
    return new SupabasePrivateMediaStore(
      process.env.SUPABASE_STORAGE_URL ?? "",
      process.env.SUPABASE_PRIVATE_BUCKET ?? "",
      process.env.SUPABASE_STORAGE_SERVER_KEY ?? "",
    );
  }
  return new LocalMediaStore(path.join(postgresDirectory(), "assets"));
};
export const imageName = /^[a-f0-9-]{36}\.(jpg|png|webp)$/;
export async function uploadImage(p: Principal, file: File) {
  authorize(p);
  if (postgresSelected())
    return uploadMedia(
      await postgresFor("asia_catalog_editor"),
      postgresMediaStore(),
      file,
      p.id,
    );
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error("Размер изображения: до 8 МБ");
  const bytes = await sanitizeImage(new Uint8Array(await file.arrayBuffer()));
  const ext = "webp";
  const name = `${randomUUID()}.${ext}`;
  if (p.mode === "local") {
    const dir = path.join(localDirectory(), "images");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, name), bytes, { mode: 0o600, flag: "wx" });
    return `/images/admin/${name}`;
  }
  const client = supabaseClient(p.token);
  const { error } = await client.storage
    .from("tour-images")
    .upload(`admin/${name}`, bytes, {
      contentType: "image/webp",
      upsert: false,
    });
  if (error)
    throw new Error(
      "Загрузка отклонена. Проверьте bucket tour-images и Storage RLS",
    );
  return client.storage.from("tour-images").getPublicUrl(`admin/${name}`).data
    .publicUrl;
}
export async function deleteImage(p: Principal, url: string) {
  authorize(p);
  if (postgresSelected())
    return retireMedia(await postgresFor("asia_catalog_editor"), url);
  const used =
    p.mode === "local"
      ? (await adminTours(p)).some((t) => t.images.some((i) => i.url === url))
      : await supabaseClient(p.token)
          .rpc("admin_image_is_unused", {
            object_name: `admin/${url.split("/").pop() || ""}`,
          })
          .then((result) => {
            if (result.error)
              throw new Error("Не удалось проверить ссылки на изображение");
            return result.data !== true;
          });
  if (used) throw new Error("Сначала сохраните экскурсию без этой фотографии");
  const name = url.split("/").pop() || "";
  if (!imageName.test(name))
    throw new Error("Можно удалять только загруженные фотографии");
  if (p.mode === "local") {
    if (url !== `/images/admin/${name}`) throw new Error("Недопустимый путь");
    await unlink(path.join(localDirectory(), "images", name)).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    return;
  }
  const client = supabaseClient(p.token);
  const expected = client.storage
    .from("tour-images")
    .getPublicUrl(`admin/${name}`).data.publicUrl;
  if (url !== expected) throw new Error("Изображение вне хранилища проекта");
  const { error } = await client.storage
    .from("tour-images")
    .remove([`admin/${name}`]);
  if (error) throw new Error("Не удалось удалить файл");
}
export async function localImage(name: string) {
  if (postgresSelected())
    return readMedia(
      await postgresFor("asia_catalog_editor"),
      postgresMediaStore(),
      name,
    );
  if (!imageName.test(name)) throw new Error("Изображение не найдено");
  return readFile(path.join(localDirectory(), "images", name));
}
