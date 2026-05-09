import { rcedit } from "rcedit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const exePath = resolve("src-tauri/target/release/bluecheese-ffmpeg.exe");
const iconPath = resolve("src-tauri/icons/icon.ico");

if (!existsSync(exePath)) {
  throw new Error(`Missing release executable: ${exePath}`);
}

if (!existsSync(iconPath)) {
  throw new Error(`Missing icon: ${iconPath}`);
}

await rcedit(exePath, {
  icon: iconPath,
});

console.log(`Patched EXE icon: ${exePath}`);
