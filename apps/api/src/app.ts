import fastify from "fastify";
import { healthRoutes } from "./routes/health.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { songRoutes } from "./routes/song.routes.js";
import { reviewRoutes } from "./routes/review.routes.js";
import { errorHandler } from "./utils/error-handler.js";
import fastifyJwt from "@fastify/jwt";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { env } from "./config/env.js";
import { corsOptions } from "./config/cors.js";

/** Upload da referência: 1 arquivo de até 20 MB (mesmo limite do worker). Excesso → 413. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export const app = fastify({
  logger: env.NODE_ENV !== "test",
});

app.register(cors, corsOptions);

app.register(fastifyJwt, {
  secret: env.JWT_SIGN_SECRET,
});

app.register(multipart, {
  limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 },
});

app.setErrorHandler(errorHandler);
app.register(healthRoutes, { prefix: "/api" }); // HEALTH
app.register(authRoutes, { prefix: "/api/auth" }); // AUTH
app.register(songRoutes, { prefix: "/api/songs" }); // SONGS + PERFORMANCES
app.register(reviewRoutes, { prefix: "/api/review" }); // REVISÃO DA LETRA (MCP, token de serviço)
