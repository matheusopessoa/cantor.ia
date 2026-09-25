import type { FastifyInstance } from "fastify";
import { checkHealth } from "../controllers/health.controller.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", checkHealth);
}