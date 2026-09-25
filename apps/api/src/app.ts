import fastify from "fastify";
import { healthRoutes } from "./routes/health.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { errorHandler } from "./utils/error-handler.js";
import fastifyJwt from "@fastify/jwt";
import cors from "@fastify/cors";
import { env } from "./config/env.js";
import { corsOptions } from "./config/cors.js";

export const app = fastify({
  logger: env.NODE_ENV !== "test",
});

app.register(cors, corsOptions);

app.register(fastifyJwt, {
  secret: env.JWT_SIGN_SECRET,
});

app.setErrorHandler(errorHandler);
app.register(healthRoutes, { prefix: "/api" }); // HEALTH
app.register(authRoutes, { prefix: "/api/auth" }); // AUTH
