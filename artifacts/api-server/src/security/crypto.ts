import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const configured = process.env.APP_ENCRYPTION_KEY ?? process.env.MANUS_JWT_SECRET ?? process.env.SESSION_SECRET;
  if (!configured) throw new Error("APP_ENCRYPTION_KEY must be configured for credential encryption");
  return createHash("sha256").update(configured).digest();
}
export function encryptSecret(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}
export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (!value.startsWith("enc:v1:")) return value;
  const [, , ivText, tagText, dataText] = value.split(":");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}
