import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ReviewDisabledError, ReviewUnauthorizedError } from "./errors.js";

/**
 * Comparação em tempo constante de dois textos. Compara os SHA-256 (tamanho fixo) para não
 * vazar nem o tamanho do segredo pelo tempo de resposta.
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/** O token do header `Authorization: Bearer <token>`, ou `null` sem ele. */
export function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match?.[1] ?? null;
}

/**
 * Hook `onRequest` das rotas `/api/review/*` (sdd-012, regra 2): a API não tem login, então
 * a revisão da letra usa um token de serviço. Sem `LYRICS_REVIEW_SECRET` no servidor, a
 * revisão fica desligada (503) e o resto da API segue normal. O segredo nunca vai para log
 * nem para a resposta.
 */
export function reviewAuth(secret: string | undefined) {
  return async function onRequest(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (secret === undefined) throw new ReviewDisabledError();
    const token = bearerToken(request.headers.authorization);
    if (token === null || !safeEqual(token, secret)) throw new ReviewUnauthorizedError();
  };
}
