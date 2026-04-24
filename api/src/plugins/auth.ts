import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { unauthorized } from '../errors.js';
import { type TokenPayload, verifyToken } from '../lib/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: TokenPayload;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export default fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', undefined as unknown as TokenPayload);

  app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (req.routeOptions.config?.public) return;

    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw unauthorized('Missing or invalid Authorization header');
    }

    const token = header.slice(7);
    try {
      const payload = await verifyToken(token);
      if (payload.type === 'refresh') {
        throw unauthorized('Cannot use refresh token for API access');
      }
      req.user = payload;
    } catch (err) {
      if (err instanceof Error && err.message.includes('Cannot use refresh')) throw err;
      throw unauthorized('Invalid or expired token');
    }
  });
});
