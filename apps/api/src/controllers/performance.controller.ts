import type { FastifyReply, FastifyRequest } from "fastify";
import { performanceService } from "../services/performance.service.js";
import { performanceBodySchema, rankingQuerySchema, songParamsSchema } from "../utils/validators.js";

export async function submitPerformance(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const body = performanceBodySchema.parse(request.body);
  const result = await performanceService.submit(id, body);
  return reply.status(201).send(result);
}

export async function getRanking(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const { limit } = rankingQuerySchema.parse(request.query);
  const ranking = await performanceService.ranking(id, limit);
  return reply.status(200).send(ranking);
}
