import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import path from "node:path";
const reader = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const email = await reader.question("Локальный администратор, email: ");
reader.close();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error("Укажите корректный email");
if (!process.stdin.isTTY)
  throw new Error("Запустите настройку в интерактивном терминале");
process.stdout.write("Пароль (минимум 12 символов; ввод скрыт): ");
process.stdin.setRawMode(true);
process.stdin.resume();
const password = await new Promise((resolve, reject) => {
  let value = "";
  const onData = (chunk) => {
    for (const char of chunk.toString()) {
      if (char === "\u0003") {
        cleanup();
        reject(new Error("Отменено"));
        return;
      }
      if (char === "\r" || char === "\n") {
        cleanup();
        resolve(value);
        return;
      }
      if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
      else value += char;
    }
  };
  const cleanup = () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.off("data", onData);
    process.stdout.write("\n");
  };
  process.stdin.on("data", onData);
});
if (password.length < 12 || password.length > 256)
  throw new Error("Длина пароля: 12–256 символов");
const salt = randomBytes(24).toString("hex");
const identity = {
  email,
  salt,
  hash: scryptSync(password, salt, 64).toString("hex"),
  secret: randomBytes(48).toString("hex"),
};
const root = path.join(process.cwd(), ".admin-local");
const profile = process.env.ADMIN_LOCAL_DIRECTORY;
if (
  profile &&
  profile !== ".admin-local" &&
  !/^\.admin-local[\\/][a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)
)
  throw new Error(
    "Локальная настройка должна находиться в отдельном профиле .admin-local",
  );
const directory =
  !profile || profile === ".admin-local"
    ? root
    : path.join(root, profile.split(/[\\/]/)[1]);
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  path.join(directory, "identity.json"),
  JSON.stringify(identity),
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Администратор создан. Установите ADMIN_MODE=local в .env.local и запустите pnpm dev на localhost. Production отключает локальный режим.",
);
