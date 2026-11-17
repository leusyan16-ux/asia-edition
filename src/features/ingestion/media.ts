import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { imageType, sanitizeImage } from "../admin/image-validation";
import type { SQL } from "./postgres-worker";
export const mediaKey =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/;
/** Future Storage adapters remain private/server-only. Retention is separate. */
export interface MediaStore {
  backend: "local" | "supabase";
  put(key: string, bytes: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
}
export class LocalMediaStore implements MediaStore {
  readonly backend = "local" as const;
  constructor(readonly directory: string) {}
  private async file(key: string) {
    if (!mediaKey.test(key)) throw new Error("Недопустимый ключ фотографии");
    const base = path.join(process.cwd(), ".admin-postgres"),
      root = path.resolve(this.directory);
    const relative = path.relative(base, root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Media root outside private PostgreSQL storage");
    await mkdir(base, { recursive: true, mode: 0o700 });
    if ((await lstat(base)).isSymbolicLink())
      throw new Error("Media symlinks are forbidden");
    let current = base;
    for (const segment of relative.split(path.sep)) {
      // Runtime-only private storage. Never trace or package uploaded bytes.
      current = path.join(/* turbopackIgnore: true */ current, segment);
      try {
        await lstat(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(current, { mode: 0o700 });
      }
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Media symlinks are forbidden");
    }
    const canonical = path.relative(await realpath(base), await realpath(root));
    if (canonical.startsWith("..") || path.isAbsolute(canonical))
      throw new Error("Unsafe media root");
    return path.join(root, key);
  }
  async put(key: string, bytes: Uint8Array) {
    await writeFile(await this.file(key), bytes, { flag: "wx", mode: 0o600 });
  }
  async read(key: string) {
    const file = await this.file(key);
    if ((await lstat(file)).isSymbolicLink())
      throw new Error("Media symlink forbidden");
    return readFile(file);
  }
}
export async function uploadMedia(
  db: SQL,
  store: MediaStore,
  file: File,
  actor: string,
) {
  if (!file.size || file.size > 8 * 1024 * 1024)
    throw new Error("Фотография должна быть размером до 8 МБ");
  const types: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  if (!types[file.type]) throw new Error("Разрешены JPEG, PNG и WebP");
  const input = new Uint8Array(await file.arrayBuffer());
  if (imageType(input) !== types[file.type])
    throw new Error("Тип файла не совпадает с содержимым");
  const bytes = await sanitizeImage(input);
  if (bytes.length > 8 * 1024 * 1024)
    throw new Error("Обработанная фотография превышает 8 МБ");
  const id = randomUUID(),
    key = id + ".webp";
  await store.put(key, bytes);
  await db.query(
    "insert into catalog_projection.media_assets(id,key,bytes,sha256,actor,storage_backend) values($1,$2,$3,$4,$5,$6)",
    [
      id,
      key,
      bytes.length,
      createHash("sha256").update(bytes).digest("hex"),
      actor,
      store.backend,
    ],
  );
  return "/images/admin/" + key;
}
export async function readMedia(
  db: SQL,
  store: MediaStore,
  key: string,
  publicOnly = false,
) {
  if (!mediaKey.test(key)) throw new Error("Фотография не найдена");
  const rows = publicOnly
    ? await db.query("select 1 where catalog_projection.media_visible($1)", [
        key,
      ])
    : await db.query(
        "select id from catalog_projection.media_assets where key=$1 and retired_at is null",
        [key],
      );
  if (!rows.rows.length) throw new Error("Фотография не найдена");
  return store.read(key);
}
export async function retireMedia(db: SQL, url: string) {
  const key = url.split("/").at(-1) ?? "";
  if (!mediaKey.test(key) || url !== "/images/admin/" + key)
    throw new Error("Можно удалить только фотографию этого профиля");
  await db.query("select catalog_projection.retire_media($1)", [key]);
}
