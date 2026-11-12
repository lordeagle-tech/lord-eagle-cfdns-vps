import { Router } from "express";
import { beginOAuth, completeOAuth, currentUser, destroySession } from "../security/session";
const router = Router();
router.get("/auth/login", (req, res) => beginOAuth(req, res));
router.get("/auth/callback", async (req, res) => { try { await completeOAuth(req, res); } catch (error) { res.redirect(`/login?error=${encodeURIComponent(error instanceof Error ? error.message : "Authentication failed")}`); } });
router.get("/auth/me", async (req, res) => { const user = await currentUser(req); if (!user) { res.status(401).json({ error: "Not signed in" }); return; } res.json({ user }); });
router.get("/auth/verify", async (req, res) => { const user = await currentUser(req); if (!user) { res.status(401).json({ error: "Not signed in" }); return; } res.json({ ok: true, user }); });
router.post("/auth/logout", async (req, res) => { await destroySession(req, res); res.json({ ok: true }); });
export default router;
