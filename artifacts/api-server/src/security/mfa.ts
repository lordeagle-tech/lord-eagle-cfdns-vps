import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { decryptSecret, encryptSecret } from "./crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MFA_CHALLENGE_COOKIE = "cfdns_mfa_challenge";
const MFA_CHALLENGE_TTL_SECONDS = 300;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base32Encode(value: Buffer): string {
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(buffer >>> bits) & 31];
    }
    buffer &= bits ? (1 << bits) - 1 : 0;
  }
  if (bits) output += BASE32[(buffer << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.toUpperCase().replace(/=+$/, "")) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) throw new Error("Invalid authenticator secret");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 255);
      buffer &= bits ? (1 << bits) - 1 : 0;
    }
  }
  return Buffer.from(output);
}

function totp(secret: string, timestamp: number): string {
  const counter = Math.floor(timestamp / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const binary = ((digest[offset] & 127) << 24) |
    ((digest[offset + 1] & 255) << 16) |
    ((digest[offset + 2] & 255) << 8) |
    (digest[offset + 3] & 255);
  return String(binary % 1_000_000).padStart(6, "0");
}

function verifyTotp(secret: string, code: string): boolean {
  const submitted = code.trim();
  if (!/^\d{6}$/.test(submitted)) return false;
  const now = Date.now();
  for (const offset of [-30_000, 0, 30_000]) {
    const expected = Buffer.from(totp(secret, now + offset));
    const candidate = Buffer.from(submitted);
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) return true;
  }
  return false;
}

function cookieValue(req: Request): string | null {
  for (const piece of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = piece.trim().split("=");
    if (key === MFA_CHALLENGE_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function isMfaEnabled(userId: number): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    `SELECT user_id FROM user_mfa WHERE user_id=? AND enabled_at IS NOT NULL LIMIT 1`,
    [userId],
  );
  return rows.length > 0;
}

export async function createMfaSetup(userId: number, accountName: string): Promise<{ secret: string; otpauthUrl: string } | null> {
  const generatedSecret = base32Encode(randomBytes(20));
  const encrypted = encryptSecret(generatedSecret);
  if (!encrypted) throw new Error("Could not encrypt the authenticator secret");
  await pool.execute(
    `INSERT INTO user_mfa (user_id, secret_encrypted, enabled_at, recovery_codes, pending_expires_at)
     VALUES (?, ?, NULL, NULL, DATE_ADD(NOW(), INTERVAL 10 MINUTE))
     ON DUPLICATE KEY UPDATE
       secret_encrypted=IF(enabled_at IS NULL AND (pending_expires_at IS NULL OR pending_expires_at<=NOW()), VALUES(secret_encrypted), secret_encrypted),
       pending_expires_at=IF(enabled_at IS NULL AND (pending_expires_at IS NULL OR pending_expires_at<=NOW()), DATE_ADD(NOW(), INTERVAL 10 MINUTE), pending_expires_at)`,
    [userId, encrypted],
  );
  const [rows] = await pool.query<any[]>(
    `SELECT secret_encrypted AS secretEncrypted, enabled_at AS enabledAt,
       pending_expires_at AS pendingExpiresAt
     FROM user_mfa WHERE user_id=? LIMIT 1`,
    [userId],
  );
  if (!rows[0] || rows[0].enabledAt || !rows[0].pendingExpiresAt) return null;
  const secret = decryptSecret(String(rows[0].secretEncrypted));
  if (!secret) throw new Error("Could not read the authenticator secret");
  const label = encodeURIComponent(`CFDNS Manager:${accountName || "admin"}`);
  const issuer = encodeURIComponent("CFDNS Manager");
  return {
    secret,
    otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
  };
}

export async function enableMfa(userId: number, code: string): Promise<string[] | null> {
  const [rows] = await pool.query<any[]>(
    `SELECT secret_encrypted AS secretEncrypted FROM user_mfa
     WHERE user_id=? AND enabled_at IS NULL AND pending_expires_at>NOW() LIMIT 1`,
    [userId],
  );
  if (!rows[0]) return null;
  const secret = decryptSecret(String(rows[0].secretEncrypted));
  if (!secret || !verifyTotp(secret, code)) return null;
  const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(8).toString("hex"));
  const recoveryHashes = JSON.stringify(recoveryCodes.map((item) => hash(item)));
  const [result] = await pool.execute<any>(
    `UPDATE user_mfa SET enabled_at=NOW(), recovery_codes=?, pending_expires_at=NULL
     WHERE user_id=? AND enabled_at IS NULL AND pending_expires_at>NOW()`,
    [recoveryHashes, userId],
  );
  return result.affectedRows === 1 ? recoveryCodes : null;
}

export async function verifyMfaCode(userId: number, code: string): Promise<boolean> {
  const [rows] = await pool.query<any[]>(
    `SELECT secret_encrypted AS secretEncrypted, recovery_codes AS recoveryCodes
     FROM user_mfa WHERE user_id=? AND enabled_at IS NOT NULL LIMIT 1`,
    [userId],
  );
  if (!rows[0]) return false;
  const secret = decryptSecret(String(rows[0].secretEncrypted));
  if (secret && verifyTotp(secret, code)) return true;

  const normalized = code.trim().replace(/[\s-]/g, "").toLowerCase();
  if (!/^[a-f0-9]{16}$/.test(normalized) || typeof rows[0].recoveryCodes !== "string") return false;
  let recoveryHashes: string[];
  try {
    const parsed: unknown = JSON.parse(rows[0].recoveryCodes);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string" && /^[a-f0-9]{64}$/.test(item))) return false;
    recoveryHashes = parsed;
  } catch { return false; }
  const submittedHash = Buffer.from(hash(normalized), "hex");
  const matchedIndex = recoveryHashes.findIndex((item) => {
    const storedHash = Buffer.from(item, "hex");
    return storedHash.length === submittedHash.length && timingSafeEqual(storedHash, submittedHash);
  });
  if (matchedIndex < 0) return false;
  const nextHashes = recoveryHashes.filter((_item, index) => index !== matchedIndex);
  const [result] = await pool.execute<any>(
    `UPDATE user_mfa SET recovery_codes=? WHERE user_id=? AND recovery_codes=? AND enabled_at IS NOT NULL`,
    [JSON.stringify(nextHashes), userId, rows[0].recoveryCodes],
  );
  return result.affectedRows === 1;
}

export async function disableMfa(userId: number, code: string): Promise<boolean> {
  if (!await verifyMfaCode(userId, code)) return false;
  await pool.execute(`DELETE FROM user_mfa WHERE user_id=?`, [userId]);
  await pool.execute(`DELETE FROM auth_mfa_challenges WHERE user_id=?`, [userId]);
  return true;
}

export async function createMfaChallenge(userId: number, res: Response): Promise<void> {
  const token = randomBytes(32).toString("hex");
  await pool.execute(`DELETE FROM auth_mfa_challenges WHERE user_id=? OR expires_at<=NOW()`, [userId]);
  await pool.execute(
    `INSERT INTO auth_mfa_challenges (token_hash, user_id, attempts, expires_at)
     VALUES (?, ?, 0, DATE_ADD(NOW(), INTERVAL ${MFA_CHALLENGE_TTL_SECONDS} SECOND))`,
    [hash(token), userId],
  );
  res.cookie(MFA_CHALLENGE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/auth/mfa",
    maxAge: MFA_CHALLENGE_TTL_SECONDS * 1000,
  });
}

export async function getMfaChallenge(req: Request): Promise<{ tokenHash: string; userId: number; attempts: number } | null> {
  const token = cookieValue(req);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = hash(token);
  const [rows] = await pool.query<any[]>(
    `SELECT token_hash AS tokenHash, user_id AS userId, attempts
     FROM auth_mfa_challenges WHERE token_hash=? AND expires_at>NOW() LIMIT 1`,
    [tokenHash],
  );
  if (!rows[0]) return null;
  return { tokenHash, userId: Number(rows[0].userId), attempts: Number(rows[0].attempts) };
}

export async function recordMfaChallengeFailure(tokenHash: string): Promise<number> {
  await pool.execute(
    `UPDATE auth_mfa_challenges SET attempts=attempts+1
     WHERE token_hash=? AND expires_at>NOW() AND attempts<5`,
    [tokenHash],
  );
  const [rows] = await pool.query<any[]>(
    `SELECT attempts FROM auth_mfa_challenges WHERE token_hash=? LIMIT 1`,
    [tokenHash],
  );
  const attempts = Number(rows[0]?.attempts ?? 5);
  if (attempts >= 5) await pool.execute(`DELETE FROM auth_mfa_challenges WHERE token_hash=?`, [tokenHash]);
  return attempts;
}

export async function consumeMfaChallenge(tokenHash: string): Promise<boolean> {
  const [result] = await pool.execute<any>(
    `DELETE FROM auth_mfa_challenges WHERE token_hash=? AND expires_at>NOW() AND attempts<5`,
    [tokenHash],
  );
  return result.affectedRows === 1;
}

export function clearMfaChallenge(res: Response): void {
  res.clearCookie(MFA_CHALLENGE_COOKIE, { httpOnly: true, secure: true, sameSite: "strict", path: "/api/auth/mfa" });
}
