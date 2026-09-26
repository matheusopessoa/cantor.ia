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
- Nem todo service fala com um repositório. [`scoring.service.ts`](../src/services/scoring.service.ts)
  é uma função pura: recebe dois `PitchTrack` (referência e voz cantada) e as linhas da letra e
  devolve a nota de 0 a 10 (`ScoreResult`: nota final, afinação, tempo, transposição detectada,
  cobertura e resultado por linha). As constantes de calibração ficam em `SCORING_CONFIG`.
  Algoritmo e critérios em [`specs/sdd-002-scoring/tasks.md`](../../../specs/sdd-002-scoring/tasks.md).

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
- [`validators.ts`](../src/utils/validators.ts) — schemas Zod dos contratos: corpos das rotas
  de auth e os formatos compartilhados `pitchTrackSchema` (curva de pitch do worker, contrato
  em `specs/sdd-001-worker-pitch/tasks.md` §4) e `lyricLineSchema` (linha do LRC), com os
  tipos `PitchTrack` e `LyricLine` inferidos.
- [`pitch.ts`](../src/utils/pitch.ts) — matemática pura sobre curvas de pitch: `fold12`
  (diferença em semitons módulo oitava, em [-6, 6)), `median` e `findOnset` (primeiro início
  de voz numa janela de frames). Usado pelo `scoring.service.ts`.
- [`errors.ts`](../src/utils/errors.ts) — `AppError` (com `statusCode`) e erros de negócio
  como `UserAlreadyExistsError` e `InvalidReferenceError` (422: referência sem nenhum frame
  com voz).
- [`error-handler.ts`](../src/utils/error-handler.ts) — handler global do Fastify que traduz
  cada tipo de erro em status code + mensagem. Registrado em [`app.ts`](../src/app.ts).

## Como adicionar um recurso novo

1. `repositories/<recurso>.repository.ts` — as consultas ao banco.
2. `services/<recurso>.service.ts` — a regra de negócio.
3. `controllers/<recurso>.controller.ts` — validação Zod + resposta HTTP.
4. `routes/<recurso>.routes.ts` — as rotas, registradas em [`app.ts`](../src/app.ts).
