import { randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';

/**
 * Assigns / propagates X-Request-Id.
 * Fastify has `genReqId` but this plugin also echoes the id back in response headers
 * so clients can correlate from logs.
 */
export default fp(async (app) => {
  app.addHook('onRequest', (req, reply, done) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    (req as unknown as { id: string }).id = id;
    reply.header('x-request-id', id);
    done();
  });
});
