# Arquitetura

Arquitetura em camadas simples. O fluxo de uma requisição é sempre o mesmo e em uma
única direção:

```
routes → controllers → services → repositories → banco de dados
                            ↑
                          utils
```

Cada camada só conhece a camada imediatamente abaixo. Não há injeção de dependência
via construtor, factories ou interfaces de "portas": os módulos são importados
diretamente, o que mantém o código curto e fácil de navegar.

## `src/routes/`

- **Função**: Mapear método + URL para um controller (`app.post("/users", registerUser)`).
- **Regra**: Apenas declaração de caminhos. Nenhuma lógica.

## `src/controllers/`

- **Função**: Fronteira HTTP. Validar a entrada com Zod, chamar o service e devolver a resposta.
- **Regra**: É o único lugar que conhece `FastifyRequest`/`FastifyReply`. Não contém regra de
  negócio. Erros são lançados e tratados pelo error handler global em
  [`utils/error-handler.ts`](../src/utils/error-handler.ts) (`ZodError` → 400,
  `AppError` → seu `statusCode`), que o [`app.ts`](../src/app.ts) apenas registra.

## `src/services/`

- **Função**: Regra de negócio. Orquestra hashing, geração de id, validações de negócio e
  chamadas ao repositório.
- **Regra**: Não conhece HTTP nem SQL. Recebe dados simples e retorna DTOs simples (ex:
  `PublicUser`, sem `password`). Lança `AppError` (ou subclasses) para falhas de negócio.

## `src/repositories/`

- **Função**: Acesso a dados. Fala diretamente com o Prisma Client.
- **Regra**: Só consultas ao banco. Retorna os models do Prisma; qualquer transformação para
  DTO acontece no service.

## `src/utils/`

Peças compartilhadas, sem estado de negócio:

- [`prisma.ts`](../src/utils/prisma.ts) — instância única do Prisma Client.
- [`hash.ts`](../src/utils/hash.ts) — `hash`/`compare` com bcrypt.
- [`bindex.ts`](../src/utils/bindex.ts) — blind index determinístico (HMAC-SHA256)
  para busca de e-mail. Depende da variável de ambiente `EMAIL_BINDEX_SECRET`.
- [`errors.ts`](../src/utils/errors.ts) — `AppError` (com `statusCode`) e erros de negócio
  como `UserAlreadyExistsError`.
- [`error-handler.ts`](../src/utils/error-handler.ts) — handler global do Fastify que traduz
  cada tipo de erro em status code + mensagem. Registrado em [`app.ts`](../src/app.ts).

## Como adicionar um recurso novo

1. `repositories/<recurso>.repository.ts` — as consultas ao banco.
2. `services/<recurso>.service.ts` — a regra de negócio.
3. `controllers/<recurso>.controller.ts` — validação Zod + resposta HTTP.
4. `routes/<recurso>.routes.ts` — as rotas, registradas em [`app.ts`](../src/app.ts).
