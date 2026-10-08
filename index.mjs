import Server from './src/server.mjs';

const server = new Server(process.argv[2]);

await server.run();

// Ctrl+C ou arrêt du conteneur : on ferme proprement le serveur HTTP et MongoDB
const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
