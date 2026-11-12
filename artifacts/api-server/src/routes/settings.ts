import { Router } from "express";
import { getMaskedKey } from "../key-store";

const router = Router();

router.get("/settings", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ maskedKey: getMaskedKey() });
});

export default router;
