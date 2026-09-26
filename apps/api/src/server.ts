import { app } from "./app.js";
import { songRepository } from "./repositories/song.repository.js";

const start = async () => {
  const bootedAt = new Date();
  try {
    // O host '0.0.0.0' é necessário para expor a porta corretamente no Docker
    await app.listen({ port: 3333, host: "0.0.0.0" });
    console.log("🚀 Servidor HTTP rodando na porta 3333");

    // O processamento da referência vive neste processo: o que ficou em PROCESSING de antes
    // desta subida é de uma execução que reiniciou ou caiu, e ninguém vai terminar (achado da
    // sdd-011). Só depois do `listen`: se a porta está ocupada (outra API viva, ex.: um
    // `tsx watch` duplicado), o processo sai sem tocar no banco. Fica aqui, e não no app.ts,
    // para os testes que importam o app não dispararem isso.
    const interrupted = await songRepository.failOrphanedProcessing(bootedAt);
    if (interrupted > 0) console.log(`⚠️  ${interrupted} referência(s) interrompida(s) marcada(s) como FAILED`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
