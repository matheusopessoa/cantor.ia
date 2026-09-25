import type { FastifyRequest, FastifyReply } from "fastify";
import { registerUserBodySchema, loginBodySchema } from "../utils/validators.js";
import { authService } from "../services/auth.service.js";

export async function registerUser(request: FastifyRequest, reply: FastifyReply) {
    const data = registerUserBodySchema.parse(request.body);
    const user = await authService.register(data);
    return reply.status(201).send(user);
}

export async function loginUser(request: FastifyRequest, reply: FastifyReply) {
    const data = loginBodySchema.parse(request.body);
    const loginData = await authService.login(data, request.server)
    return reply.status(200).send(loginData);
}