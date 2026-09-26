This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Variáveis de ambiente

O web não tem `.env` próprio: o `next.config.ts` lê o `.env` da raiz do monorepo (crie com
`pnpm env:init` na raiz) e copia só as chaves abaixo. Leia sempre por `lib/env.public.ts` ou
`lib/env.server.ts`, nunca `process.env` direto.

| Variável | Onde | Observação |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | browser (`publicEnv.apiUrl`) | Embutida no bundle no `next build`: mudar exige rebuild. No Docker, é build arg. Nunca coloque segredo aqui. |
| `API_INTERNAL_URL` | servidor (`serverEnv.apiInternalUrl`) | Opcional; sem ela usa `NEXT_PUBLIC_API_URL`. No compose é `http://api:3333`. |

Para adicionar uma variável ao web: inclua a chave em `WEB_ENV_KEYS` (`next.config.ts`), no
módulo de leitura certo, no `.env.example` da raiz e no compose.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
