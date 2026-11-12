/**
 * Integration tests for GET /api/files/raw.
 * For authenticated file tests, start the API and provide TEST_API_BASE,
 * TEST_API_KEY, and TEST_ALLOWED_FILE inside FILE_MANAGER_ROOTS.
 */
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.TEST_API_BASE ?? "http://127.0.0.1:3000";
const API_KEY = process.env.TEST_API_KEY;
const APP_ORIGIN = process.env.TEST_APP_ORIGIN ?? new URL(BASE).origin;
let sessionCookie = "";

before(async () => {
  if (!API_KEY) return;
  const response = await fetch(`${BASE}/api/auth/key-login`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, Origin: APP_ORIGIN },
  });
  assert.equal(response.status, 200, "temporary integration login should succeed");
  sessionCookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(sessionCookie, /^webdev_app_session=/);
});

async function get(path, authenticated = true) {
  const res = await fetch(`${BASE}${path}`, {
    headers: authenticated && sessionCookie ? { Cookie: sessionCookie } : {},
  });
  const body = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : await res.text();
  return { status: res.status, body, headers: res.headers };
}

describe("GET /api/files/raw", () => {
  test("unauthenticated requests are denied", async () => {
    const { status } = await get("/api/files/raw?path=/etc/hostname", false);
    assert.equal(status, 401);
  });

  test("configured in-root file returns bytes and hardened preview headers", { skip: !API_KEY || !process.env.TEST_ALLOWED_FILE }, async () => {
    const { status, headers } = await get(`/api/files/raw?path=${encodeURIComponent(process.env.TEST_ALLOWED_FILE)}`);
    assert.equal(status, 200);
    assert.ok(headers.get("content-length"), "Content-Length should be set");
    assert.ok(headers.get("accept-ranges"), "Accept-Ranges should be set");
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.match(headers.get("content-security-policy") ?? "", /sandbox/);
  });

  test("missing path is rejected", { skip: !API_KEY }, async () => {
    const { status, body } = await get("/api/files/raw");
    assert.equal(status, 403);
    assert.ok(body.error);
  });

  test("relative and traversal paths are rejected", { skip: !API_KEY }, async () => {
    for (const path of ["../../etc/passwd", "/tmp/../../etc/shadow", "/tmp%2F..%2F..%2Fetc%2Fpasswd"]) {
      const { status } = await get(`/api/files/raw?path=${path}`);
      assert.ok(status === 400 || status === 403, `unexpected status for ${path}: ${status}`);
    }
  });

  test("outside-root host files are denied", { skip: !API_KEY }, async () => {
    const { status } = await get(`/api/files/raw?path=${encodeURIComponent(process.env.TEST_OUTSIDE_FILE ?? "/etc/hostname")}`);
    assert.equal(status, 403);
  });
});
