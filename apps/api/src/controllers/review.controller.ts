import type { FastifyReply, FastifyRequest } from "fastify";
import { lyricsReviewService } from "../services/lyrics-review.service.js";
import { reviewApplyBodySchema, reviewCheckBodySchema, reviewListQuerySchema, songParamsSchema } from "../utils/validators.js";

/** Revisão da letra pelo MCP (sdd-012). O token é conferido no `onRequest` das rotas. */

export async function listReviewSongs(request: FastifyRequest, reply: FastifyReply) {
  const { limit } = reviewListQuerySchema.parse(request.query);
  const songs = await lyricsReviewService.list(limit);
  return reply.status(200).send(songs);
}

export async function getReviewSong(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const detail = await lyricsReviewService.detail(id);
  return reply.status(200).send(detail);
}

/** Síncrona: o worker baixa, isola a voz e alinha as duas letras (até ~3 min). */
export async function checkLyricsFix(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const { lines } = reviewCheckBodySchema.parse(request.body);
  const check = await lyricsReviewService.check(id, lines);
  return reply.status(200).send(check);
}

export async function applyLyricsFix(request: FastifyRequest, reply: FastifyReply) {
  const { id } = songParamsSchema.parse(request.params);
  const { checkId } = reviewApplyBodySchema.parse(request.body);
  const song = await lyricsReviewService.apply(id, checkId);
  return reply.status(200).send(song);
}
