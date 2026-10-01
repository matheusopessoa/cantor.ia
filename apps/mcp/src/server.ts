import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createReviewApi, ReviewApiError, type ReviewApi } from "./api-client.js";
import { EnvError, loadEnv } from "./env.js";
import { formatApplied, formatCheck, formatError, formatSongDetail, formatSongList } from "./format.js";

/**
 * Servidor MCP do cantor.ia (sdd-012): o Claude Code revisa a letra das músicas, sob demanda,
 * pelas rotas `/api/review/*` da API. Transporte stdio: nada pode ir para o stdout além do
 * protocolo (logs vão para o stderr).
 */

const LIMIT_OF_MEMORY =
  "Limite: não escreva a letra de memória (direitos autorais). Corrija pontos com base na transcrição da voz, nas letras dos sites e no score do áudio.";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

/** Falha da API vira mensagem legível (status + código + o que fazer), nunca um stack trace. */
async function run(action: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await action());
  } catch (error) {
    if (error instanceof ReviewApiError) return { ...text(formatError(error)), isError: true };
    return { ...text(`Erro inesperado no MCP: ${error instanceof Error ? error.message : String(error)}`), isError: true };
  }
}

export function createServer(api: ReviewApi): McpServer {
  const server = new McpServer({ name: "cantor", version: "0.1.0" });

  server.registerTool(
    "list_songs_to_review",
    {
      title: "Músicas para revisar",
      description:
        "Lista as músicas do cantor.ia com a referência pronta, da mais urgente para a menos: primeiro as que têm a letra transcrita automaticamente da voz (whisper, com erros de palavra), depois as com menor encaixe no áudio. Mostra a origem da letra, quantos versos tem e se já foi revisada.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional().describe("Quantas músicas listar (padrão 20)") },
    },
    async ({ limit }) => run(async () => formatSongList(await api.listSongs(limit))),
  );

  server.registerTool(
    "get_song_lyrics",
    {
      title: "Ler a letra com a evidência",
      description:
        `Devolve a letra em uso de uma música (versos numerados com o tempo de entrada), o que o Whisper ouviu na gravação (em trechos, com tempo) e as letras que os sites tinham. É a base para propor correções. ${LIMIT_OF_MEMORY}`,
      inputSchema: { songId: z.uuid().describe("O id da música (de list_songs_to_review)") },
    },
    async ({ songId }) => run(async () => formatSongDetail(await api.getSong(songId))),
  );

  server.registerTool(
    "check_lyrics_fix",
    {
      title: "Conferir uma correção no áudio",
      description:
        `Confere uma proposta de letra no áudio da música, sem gravar nada: o worker alinha a letra atual e a proposta sobre a mesma voz e devolve, verso a verso, o que mudou (igual, editado, novo, removido) com o score de cada verso antes e depois. Demora 1 a 3 minutos. A proposta é a letra INTEIRA, um item por verso, na ordem; verso instrumental é um texto vazio. Devolve um checkId para apply_lyrics_fix. ${LIMIT_OF_MEMORY}`,
      inputSchema: {
        songId: z.uuid().describe("O id da música"),
        lines: z.array(z.string().max(300)).min(1).max(500).describe("A letra inteira proposta, um verso por item"),
      },
    },
    async ({ songId, lines }) => run(async () => formatCheck(await api.check(songId, lines))),
  );

  server.registerTool(
    "apply_lyrics_fix",
    {
      title: "Gravar a correção aprovada",
      description:
        "Grava a letra conferida por check_lyrics_fix. SÓ CHAME DEPOIS QUE O USUÁRIO APROVAR o antes/depois mostrado pela conferência: mostre o resultado, pergunte, e chame esta ferramenta apenas com um sim explícito. A letra vira a proposta, é realinhada ao áudio com o resultado da conferência e fica marcada como revisada. Falha se a letra mudou desde a conferência ou se o checkId expirou (30 min).",
      inputSchema: {
        songId: z.uuid().describe("O id da música"),
        checkId: z.uuid().describe("O checkId devolvido por check_lyrics_fix"),
      },
    },
    async ({ songId, checkId }) => run(async () => formatApplied(await api.apply(songId, checkId))),
  );

  return server;
}

async function main(): Promise<void> {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`[cantor-mcp] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }

  const api = createReviewApi({ baseUrl: env.NEXT_PUBLIC_API_URL, secret: env.LYRICS_REVIEW_SECRET });
  const server = createServer(api);
  await server.connect(new StdioServerTransport());
  console.error(`[cantor-mcp] pronto: API em ${env.NEXT_PUBLIC_API_URL}`);
}

// `tsx src/server.ts` (dev) ou `node dist/server.js`: só sobe quando é o módulo principal, para
// os testes importarem `createServer` sem abrir o stdio.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error("[cantor-mcp] falhou ao subir:", error);
    process.exit(1);
  });
}
