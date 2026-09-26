import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "./errors.js";

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.status(400).send({ message: "Validation error", issues: error.issues });
  }

  if (error instanceof AppError) {
    // `code` só entra quando existe: as respostas de /api/auth continuam `{ message }`.
    return reply
      .status(error.statusCode)
      .send(error.code ? { message: error.message, code: error.code } : { message: error.message });
  }

  // Erros do próprio Fastify com status 4xx (corpo acima do bodyLimit ou do limite do
  // multipart → 413, JSON inválido → 400): repassa o status em vez de mascarar como 500.
  if (typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.status(error.statusCode).send({ message: error.message });
  }

  request.log.error(error);
  return reply.status(500).send({ message: "Internal server error" });
}
