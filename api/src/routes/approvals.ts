import { ApprovalStatus, ApprovalType } from '@liquor/shared';
import type { FastifyInstance } from 'fastify';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { sql } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../errors.js';
import { rbacGuard } from '../plugins/rbac.js';
import { audit } from '../services/audit.js';
import { type CreditNoteInput, applyCreditNote } from '../services/invoice.js';
import { type AdjustInput, applyAdjustment } from '../services/stock.js';

const ListQuery = z.object({
  status: ApprovalStatus.optional(),
  type: ApprovalType.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

const DecideBody = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().optional(),
});

/**
 * Per-type dispatch. On approve, execute the side effect (e.g. apply the stock
 * adjustment). On reject, the row is marked rejected — no side effect.
 * Handlers receive the original payload and must be idempotent against re-approval.
 */
async function applyApproval(
  tx: Sql,
  orgId: string,
  userId: string,
  approvalType: string,
  payload: unknown,
): Promise<unknown> {
  switch (approvalType) {
    case 'stock_adjust':
      return applyAdjustment(tx, orgId, userId, payload as AdjustInput);
    case 'credit_note': {
      const p = payload as Omit<CreditNoteInput, 'orgId' | 'userId'>;
      return applyCreditNote(tx, { ...p, orgId, userId });
    }
    case 'credit_override':
    case 'price_list':
    case 'customer_hold_release':
    case 'van_variance':
    case 'eod_variance':
      // Handlers land with the modules that own these workflows (E7/E8).
      return { deferred: true, type: approvalType };
    default:
      throw badRequest(`Unsupported approval type: ${approvalType}`);
  }
}

export default async function approvalRoutes(app: FastifyInstance) {
  // LIST approvals — admin inbox
  app.get('/approvals', { preHandler: [rbacGuard('approval', 'read')] }, async (req) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    const orgId = req.user.org_id;
    const { status, type, limit, cursor } = parsed.data;

    const conds = [sql`ar.org_id = ${orgId}`];
    if (status) conds.push(sql`ar.status = ${status}`);
    if (type) conds.push(sql`ar.type   = ${type}`);
    if (cursor) conds.push(sql`ar.id < ${cursor}`);
    const where = conds.reduce((a, b) => sql`${a} AND ${b}`);

    const rows = await sql`
        SELECT
          ar.id, ar.type, ar.ref_type, ar.ref_id, ar.status, ar.reason,
          ar.payload, ar.created_at, ar.decided_at,
          ar.requested_by, u.name AS requested_by_name,
          ar.approver_id,  ap.name AS approver_name
        FROM approval_requests ar
        LEFT JOIN users u  ON u.id  = ar.requested_by
        LEFT JOIN users ap ON ap.id = ar.approver_id
        WHERE ${where}
        ORDER BY ar.created_at DESC, ar.id DESC
        LIMIT ${limit}
      `;
    const nextCursor = rows.length === limit ? rows[rows.length - 1]!.id : null;
    return { items: rows, next_cursor: nextCursor };
  });

  // GET single approval with context
  app.get('/approvals/:id', { preHandler: [rbacGuard('approval', 'read')] }, async (req) => {
    const { id } = req.params as { id: string };
    const orgId = req.user.org_id;
    const rows = await sql`
        SELECT ar.*, u.name AS requested_by_name, ap.name AS approver_name
        FROM approval_requests ar
        LEFT JOIN users u  ON u.id  = ar.requested_by
        LEFT JOIN users ap ON ap.id = ar.approver_id
        WHERE ar.id = ${id} AND ar.org_id = ${orgId}
      `;
    if (rows.length === 0) throw notFound('Approval not found');
    return rows[0];
  });

  // DECIDE
  app.post(
    '/approvals/:id/decide',
    { preHandler: [rbacGuard('approval', 'decide')] },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = DecideBody.safeParse(req.body);
      if (!body.success) throw badRequest('Invalid request body', body.error.flatten());
      const orgId = req.user.org_id;
      const userId = req.user.sub;

      // Owner/admin only
      if (req.user.role !== 'admin' && req.user.role !== 'owner') {
        throw forbidden('Only admin or owner can decide approvals');
      }

      const result = await sql.begin(async (tx) => {
        const [appr] = await tx<
          Array<{
            id: string;
            type: string;
            status: string;
            payload: unknown;
            requested_by: string;
          }>
        >`
          SELECT id, type, status, payload, requested_by
          FROM approval_requests
          WHERE id = ${id} AND org_id = ${orgId}
          FOR UPDATE
        `;
        if (!appr) throw notFound('Approval not found');
        if (appr.status !== 'pending') throw conflict(`Approval is already ${appr.status}`);

        // Self-approval block
        if (appr.requested_by === userId) {
          throw forbidden('Cannot decide your own approval request');
        }

        let sideEffect: unknown = null;
        if (body.data.decision === 'approve') {
          sideEffect = await applyApproval(tx, orgId, userId, appr.type, appr.payload);
        }

        const newStatus = body.data.decision === 'approve' ? 'approved' : 'rejected';
        const [updated] = await tx`
          UPDATE approval_requests
          SET status = ${newStatus}, approver_id = ${userId}, decided_at = now(),
              reason = COALESCE(${body.data.note ?? null}, reason)
          WHERE id = ${id}
          RETURNING *
        `;

        await audit(
          {
            orgId,
            userId,
            action: body.data.decision === 'approve' ? 'approve' : 'reject',
            entity: 'approval_request',
            entityId: id,
            before: { status: 'pending' },
            after: { status: newStatus, note: body.data.note ?? null },
          },
          tx,
        );

        return { approval: updated, side_effect: sideEffect };
      });

      return result;
    },
  );
}
