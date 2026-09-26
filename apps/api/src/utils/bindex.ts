import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

export function emailBindex(email: string): string {
  const normalized = email.trim().toLowerCase();

  return createHmac("sha256", env.EMAIL_BINDEX_SECRET).update(normalized).digest("hex");
}
