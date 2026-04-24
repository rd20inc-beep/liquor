import { config } from './config.js';
import { sql } from './db.js';
import { buildServer } from './server.js';

async function main() {
  const app = await buildServer();

  try {
    await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.fatal({ err }, 'failed to start server');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await sql.end({ timeout: 5 });
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
