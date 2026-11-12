import fs from "fs";
import path from "path";

const KEY_FILE = path.resolve(process.env.API_KEY_FILE ?? path.join(process.cwd(), ".xcm_key"));
let _cachedKey: string | null = null;

export function getApiKey(): string | null {
  if (_cachedKey) return _cachedKey;
  try {
    const stats = fs.lstatSync(KEY_FILE);
    if (stats.isFile() && !stats.isSymbolicLink()) {
      const raw = fs.readFileSync(KEY_FILE, "utf8").trim();
      if (raw) {
        _cachedKey = raw;
        return _cachedKey;
      }
    }
  } catch { /* use the environment value on first install */ }
  _cachedKey = process.env.API_KEY ?? null;
  return _cachedKey;
}

export function setApiKey(newKey: string): void {
  const key = newKey.trim();
  if (key.length < 32) throw new Error("API keys must be at least 32 characters");
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
  const temporaryFile = `${KEY_FILE}.tmp-${process.pid}`;
  const fd = fs.openSync(temporaryFile, "w", 0o600);
  try {
    fs.writeFileSync(fd, key, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporaryFile, KEY_FILE);
  fs.chmodSync(KEY_FILE, 0o600);
  _cachedKey = key;
  process.env.API_KEY = key;
}

export function getMaskedKey(): string {
  const key = getApiKey() ?? "";
  if (key.length <= 6) return "••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-2);
}
