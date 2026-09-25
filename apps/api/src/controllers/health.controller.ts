import type { FastifyRequest, FastifyReply } from "fastify";
import { healthService } from "../services/health.service.js";

export async function checkHealth(_request: FastifyRequest, reply: FastifyReply) {
  const result = healthService.check();

  return reply.status(200).send(result);
}
