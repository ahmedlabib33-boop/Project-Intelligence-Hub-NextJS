import { existsSync, readFileSync } from "fs";
import path from "path";

function readEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawName, ...rawValue] = trimmed.split("=");
    const name = rawName.trim();
    if (process.env[name]) continue;
    let value = rawValue.join("=").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
}

let loaded = false;

export function loadServerEnv() {
  if (loaded) return;
  loaded = true;
  readEnvFile(path.join(process.cwd(), ".env.local"));
  readEnvFile(path.join(process.cwd(), "..", ".env.local"));
}

export function getServerEnv(name: string) {
  loadServerEnv();
  return process.env[name]?.trim() || "";
}
