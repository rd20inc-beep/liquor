import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { sql } from '../db.js';
import { forbidden } from '../errors.js';

interface Permission {
  role: string;
  resource: string;
  action: string;
  scope: string;
}

let permissionsCache: Permission[] = [];
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadPermissions(): Promise<Permission[]> {
  const now = Date.now();
  if (permissionsCache.length > 0 && now - cacheLoadedAt < CACHE_TTL_MS) {
    return permissionsCache;
  }
  const rows = await sql<Permission[]>`SELECT role, resource, action, scope FROM roles_permissions`;
  permissionsCache = rows;
  cacheLoadedAt = now;
  return rows;
}

function hasPermission(
  permissions: Permission[],
  role: string,
  resource: string,
  action: string,
): { allowed: boolean; scope: string } {
  for (const p of permissions) {
    if (p.role !== role) continue;
    // Wildcard match
    if (p.resource === '*' && p.action === '*') return { allowed: true, scope: p.scope };
    if (p.resource === '*' && p.action === action) return { allowed: true, scope: p.scope };
    if (p.resource === resource && p.action === '*') return { allowed: true, scope: p.scope };
    if (p.resource === resource && p.action === action) return { allowed: true, scope: p.scope };
  }
  return { allowed: false, scope: 'none' };
}

declare module 'fastify' {
  interface FastifyRequest {
    rbacScope: string;
  }
}

/**
 * RBAC guard factory. Use as a preHandler:
 *   { preHandler: [rbacGuard('order', 'create')] }
 */
export function rbacGuard(resource: string, action: string) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const permissions = await loadPermissions();
    const { allowed, scope } = hasPermission(permissions, req.user.role, resource, action);
    if (!allowed) {
      throw forbidden(`Role '${req.user.role}' cannot perform '${action}' on '${resource}'`);
    }
    req.rbacScope = scope;
  };
}

export default fp(async (app: FastifyInstance) => {
  app.decorateRequest('rbacScope', 'own');

  // Pre-warm cache
  await loadPermissions();
});
