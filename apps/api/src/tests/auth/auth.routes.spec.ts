import { describe, it, expect } from "vitest";
import { app } from "../../app.js";
import { prisma } from "../../utils/prisma.js";

const validUser = {
  email: "usuario@teste.com",
  password: "senha12345",
  name: "Usuario",
};

async function register(body: Record<string, unknown> = validUser) {
  return app.inject({ method: "POST", url: "/api/auth/register", payload: body });
}

async function login(email: string, password: string) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    payload: { email, password },
  });
}

describe("POST /api/auth/register", () => {
  it("cria o usuário e responde 201", async () => {
    const response = await register();

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      email: validUser.email,
      name: validUser.name,
    });
  });

  it("nunca devolve a senha na resposta", async () => {
    const response = await register();

    expect(response.json()).not.toHaveProperty("password");
    expect(response.body).not.toContain(validUser.password);
  });

  it("persiste a senha com hash, não em texto puro", async () => {
    await register();

    const stored = await prisma.user.findUnique({
      where: { email: validUser.email },
    });

    expect(stored?.password).toBeDefined();
    expect(stored?.password).not.toBe(validUser.password);
  });

  it("recusa email já cadastrado com 409", async () => {
    await register();

    const response = await register();

    expect(response.statusCode).toBe(409);
  });

  it("recusa senha com menos de 8 caracteres com 400", async () => {
    const response = await register({ ...validUser, password: "curta" });

    expect(response.statusCode).toBe(400);
  });

  it("recusa email inválido com 400", async () => {
    const response = await register({ ...validUser, email: "nao-e-email" });

    expect(response.statusCode).toBe(400);
  });
});

describe("POST /api/auth/login", () => {
  it("autentica e devolve os dois tokens", async () => {
    await register();

    const response = await login(validUser.email, validUser.password);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it("recusa senha errada com 401", async () => {
    await register();

    const response = await login(validUser.email, "senhaErrada123");

    expect(response.statusCode).toBe(401);
  });

  it("recusa usuário inexistente com 401", async () => {
    const response = await login("ninguem@teste.com", "senha12345");

    expect(response.statusCode).toBe(401);
  });

  it("não revela se o email existe: mesma resposta nos dois casos", async () => {
    await register();

    const senhaErrada = await login(validUser.email, "senhaErrada123");
    const inexistente = await login("ninguem@teste.com", "senha12345");

    expect(senhaErrada.statusCode).toBe(inexistente.statusCode);
    expect(senhaErrada.json()).toEqual(inexistente.json());
  });
});

describe("isolamento entre testes", () => {
  it("começa sempre com a tabela vazia", async () => {
    expect(await prisma.user.count()).toBe(0);
  });
});
