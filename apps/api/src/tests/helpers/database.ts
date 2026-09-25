import { prisma } from "../../utils/prisma.js";


export function assertTestDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error("DATABASE_URL não definida: a suíte não sabe qual banco limpar");
  }

  const database = new URL(url).pathname.replace(/^\//, "");

  if (!database.endsWith("_test")) {
    throw new Error(
      `Recusando truncar "${database}": o banco de teste precisa terminar em _test`,
    );
  }
}

export async function truncateAllTables(): Promise<void> {
  assertTestDatabase(process.env["DATABASE_URL"]);

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
