import type { AuditAction } from '@liquor/shared';
import type { Sql } from 'postgres';
import { sql as defaultSql } from '../db.js';

export interface AuditContext {
  orgId: string;
  userId?: string | null;
  action: AuditAction;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/**
 * Write an audit-log entry. Pass a `tx` when auditing as part of a larger
 * transaction; omit to write with the default pool (non-transactional).
 */
export async function audit(ctx: AuditContext, tx?: Sql): Promise<void> {
  const client = tx ?? defaultSql;
  await client`
    INSERT INTO audit_log (
      org_id, user_id, action, entity, entity_id, before_json, after_json, ip
    ) VALUES (
      ${ctx.orgId}, ${ctx.userId ?? null}, ${ctx.action}, ${ctx.entity}, ${ctx.entityId},
      ${ctx.before !== undefined ? defaultSql.json(ctx.before as never) : null},
      ${ctx.after !== undefined ? defaultSql.json(ctx.after as never) : null},
      ${ctx.ip ?? null}
    )
  `;
}
