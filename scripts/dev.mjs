/**
 * `pnpm dev` — sobe o ambiente de desenvolvimento inteiro de uma vez:
 *
 *   1. Postgres de dev no Docker (`db`, porta 5432), esperando ficar saudável.
 *   2. API (3333), web (5173) e worker (8000) como processos locais, com a saída
 *      prefixada por serviço. Processos presos nessas portas são encerrados antes.
 *
 * Ctrl+C derruba os três serviços (o banco continua no Docker; `pnpm dev --stop` para ele
 * também). `--no-worker` pula o worker (ele não é necessário para buscar músicas nem para
 * cantar uma música que já tem referência pronta).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const args = new Set(process.argv.slice(2));

const COMPOSE = ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"];
// Web na 5173: a 3000 fica livre para outros projetos e a 5000 é do AirPlay do macOS.
const PORTS = { api: 3333, web: 5173, worker: 8000 };

const COLORS = { db: "\x1b[36m", api: "\x1b[35m", web: "\x1b[33m", worker: "\x1b[32m", dev: "\x1b[90m" };
const RESET = "\x1b[0m";

function log(name, line) {
  process.stdout.write(`${COLORS[name] ?? ""}[${name}]${RESET} ${line}\n`);
}

/** `pnpm` pode não estar no PATH do shell (só via corepack): reaproveita o binário que rodou este script. */
function pnpmCommand() {
  if (process.env.npm_execpath) return [process.execPath, [process.env.npm_execpath]];
  return ["corepack", ["pnpm"]];
}

function hasCommand(command) {
  return spawnSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" }).status === 0;
}

/** Mata o que estiver escutando na porta (servidor antigo travado), sem reclamar se não há nada. */
function freePort(port) {
  spawnSync("sh", ["-c", `lsof -ti:${port} | xargs kill -9`], { stdio: "ignore" });
}

if (args.has("--stop")) {
  for (const [name, port] of Object.entries(PORTS)) {
    freePort(port);
    log(name, `porta ${port} liberada`);
  }
  log("db", "parando o Postgres de desenvolvimento…");
  const stopped = spawnSync("docker", [...COMPOSE, "stop", "db"], { cwd: root, stdio: "inherit" });
  process.exit(stopped.status ?? 1);
}

if (!existsSync(envPath)) {
  console.error("Sem .env na raiz. Rode `pnpm env:init` primeiro.");
  process.exit(1);
}

if (!hasCommand("docker")) {
  console.error("Docker não encontrado no PATH. Abra o Docker Desktop e tente de novo.");
  process.exit(1);
}

// 1. Banco (com --wait o compose só volta quando o healthcheck do Postgres passa)
log("db", "subindo o Postgres de desenvolvimento…");
const db = spawnSync("docker", [...COMPOSE, "up", "-d", "--wait", "db"], { cwd: root, stdio: "inherit" });
if (db.status !== 0) {
  console.error("Não deu para subir o banco. O Docker está ligado?");
  process.exit(db.status ?? 1);
}
log("db", "Postgres pronto em localhost:5432");

// 2. Serviços locais
const withWorker = !args.has("--no-worker");
if (withWorker && !hasCommand("uv")) {
  log("worker", "`uv` não encontrado: o worker não vai subir (brew install uv, ou use --no-worker).");
}

const [pnpm, pnpmArgs] = pnpmCommand();
const services = [
  { name: "api", command: pnpm, args: [...pnpmArgs, "--filter", "api", "dev"], cwd: root },
  { name: "web", command: pnpm, args: [...pnpmArgs, "--filter", "web", "dev"], cwd: root },
];
if (withWorker && hasCommand("uv")) {
  services.push({
    name: "worker",
    command: "uv",
    args: ["run", "uvicorn", "app.main:app", "--reload", "--port", String(PORTS.worker)],
    cwd: `${root}apps/worker`,
  });
}

for (const service of services) freePort(PORTS[service.name]);

const children = new Map();
let shuttingDown = false;

function pipeLines(stream, name) {
  let rest = "";
  stream.on("data", (chunk) => {
    rest += chunk.toString();
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) if (line.trim() !== "") log(name, line);
  });
  stream.on("end", () => {
    if (rest.trim() !== "") log(name, rest);
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("dev", "encerrando os serviços…");
  for (const [name, child] of children) {
    try {
      // Grupo de processos: leva junto o `next`, o `tsx watch` e o `uvicorn --reload` que
      // eles criam.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // já saiu
    }
    log(name, "sinal enviado");
  }
  setTimeout(() => {
    for (const child of children.values()) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // já saiu
      }
    }
    process.exit(code);
  }, 3000).unref();
}

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // grupo de processos próprio, para o shutdown derrubar os filhos também
  });
  children.set(service.name, child);
  pipeLines(child.stdout, service.name);
  pipeLines(child.stderr, service.name);
  child.on("exit", (code, signal) => {
    children.delete(service.name);
    if (shuttingDown) {
      if (children.size === 0) process.exit(code ?? 0);
      return;
    }
    log(service.name, `saiu (${signal ?? `código ${code}`}); derrubando o resto.`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

log("dev", `web http://localhost:${PORTS.web} · api http://localhost:${PORTS.api}/api/health` +
  (children.has("worker") ? ` · worker http://localhost:${PORTS.worker}` : " · sem worker"));
log("dev", "Ctrl+C derruba tudo. O primeiro start do worker baixa os pesos do Demucs.");
