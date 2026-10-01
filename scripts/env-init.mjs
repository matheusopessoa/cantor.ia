import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const examplePath = fileURLToPath(new URL("../.env.example", import.meta.url));
const envPath = fileURLToPath(new URL("../.env", import.meta.url));

if (existsSync(envPath)) {
  console.error(".env já existe. Edite à mão ou compare com .env.example.");
  process.exit(1);
}

const generated = [];

const content = readFileSync(examplePath, "utf8")
  .split("\n")
  .map((line) => {
    const match = /^([A-Z0-9_]+_SECRET)=\s*$/.exec(line);
    if (!match) return line;

    const [, key] = match;
    generated.push(key);
    return `${key}=${randomBytes(32).toString("hex")}`;
  })
  .join("\n");

// "wx" falha se o arquivo surgir entre a checagem e a escrita.
writeFileSync(envPath, content, { mode: 0o600, flag: "wx" });

console.log(".env criado a partir de .env.example.");
if (generated.length > 0) {
  console.log(`Segredos gerados: ${generated.join(", ")}`);
}
