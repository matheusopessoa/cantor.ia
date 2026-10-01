export function requireUrl(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} não definida. Rode \`corepack pnpm env:init\` na raiz do repo.`);
  }

  if (!URL.canParse(value)) {
    throw new Error(`${name} não é uma URL válida.`);
  }

  return value.replace(/\/+$/, "");
}

export const publicEnv = {
  // Acesso literal: o Next só embute NEXT_PUBLIC_* no bundle quando lê process.env.NOME direto.
  apiUrl: requireUrl("NEXT_PUBLIC_API_URL", process.env.NEXT_PUBLIC_API_URL),
};
