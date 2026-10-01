import type { FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { applyLyricsFix, checkLyricsFix, getReviewSong, listReviewSongs } from "../controllers/review.controller.js";
import { reviewAuth } from "../utils/review-auth.js";

/**
 * Revisão da letra pelo Claude Code via MCP (sdd-012). Todas as rotas exigem
 * `Authorization: Bearer <LYRICS_REVIEW_SECRET>`; sem a variável no servidor, respondem 503.
 */
export async function reviewRoutes(app: FastifyInstance) {
  app.addHook("onRequest", reviewAuth(env.LYRICS_REVIEW_SECRET));

  app.get("/songs", listReviewSongs);
  app.get("/songs/:id", getReviewSong);
  app.post("/songs/:id/check", checkLyricsFix);
  app.post("/songs/:id/apply", applyLyricsFix);
}
