import { createHmac } from "node:crypto";

export function emailBindex(email: string): string {
  const secret = process.env["EMAIL_BINDEX_SECRET"];

  if (!secret) {
    throw new Error("EMAIL_BINDEX_SECRET environment variable is not set");
  }

  const normalized = email.trim().toLowerCase();

  return createHmac("sha256", secret).update(normalized).digest("hex");
}
