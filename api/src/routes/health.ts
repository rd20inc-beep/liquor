import type { FastifyInstance } from 'fastify';
import { pingDatabase } from '../db.js';

export default async function healthRoutes(app: FastifyInstance) {
  // Liveness — process is up.
  app.get('/healthz', { config: { public: true } }, async () => ({
    status: 'ok',
    ts: new Date().toISOString(),
  }));

  // Readiness — dependencies reachable.
  app.get('/readyz', { config: { public: true } }, async (_req, reply) => {
    const db = await pingDatabase();
    const ok = db;
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ready' : 'degraded',
      checks: { database: db ? 'ok' : 'fail' },
      ts: new Date().toISOString(),
    });
  });
}
