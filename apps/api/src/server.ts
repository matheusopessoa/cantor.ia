import { app } from "./app.js";

const start = async () => {
  try {
    // O host '0.0.0.0' é necessário para expor a porta corretamente no Docker
    await app.listen({ port: 3333, host: "0.0.0.0" });
    console.log("🚀 Servidor HTTP rodando na porta 3333");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
