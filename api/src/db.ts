import postgres from 'postgres';
import { config } from './config.js';
import { logger } from './logger.js';

export const sql = postgres(config.DATABASE_URL, {
  max: 10,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: (n) => logger.debug({ notice: n }, 'pg notice'),
});

export async function pingDatabase(): Promise<boolean> {
  try {
    const rows = await sql<Array<{ ok: number }>>`SELECT 1 AS ok`;
    return rows[0]?.ok === 1;
  } catch (err) {
    logger.error({ err }, 'database ping failed');
    return false;
  }
}
