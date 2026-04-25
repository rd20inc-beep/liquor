import type { Sql } from 'postgres';

type Side = 'debit' | 'credit';
type Type = 'asset' | 'liability' | 'equity' | 'revenue' | 'cogs' | 'expense';

interface CoaNode {
  code: string;
  name: string;
  type: Type;
  side: Side;
  postable?: boolean; // default true
  control?: boolean;  // default false
  children?: CoaNode[];
}

/**
 * Default chart of accounts for a Pakistani liquor distributor.
 * Header rows (with children) are non-postable; leaves are postable.
 * Control accounts (AR/AP/Inventory) cannot receive manual JEs — only
 * subledger-driven postings touch them.
 */
const COA: CoaNode[] = [
  {
    code: '1000', name: 'Cash & Bank', type: 'asset', side: 'debit', postable: false,
    children: [
      { code: '1010', name: 'Cash on hand',          type: 'asset', side: 'debit' },
      { code: '1020', name: 'Cash in transit',       type: 'asset', side: 'debit' },
      { code: '1110', name: 'Bank — Operating',      type: 'asset', side: 'debit' },
      { code: '1210', name: 'JazzCash',              type: 'asset', side: 'debit' },
      { code: '1220', name: 'EasyPaisa',             type: 'asset', side: 'debit' },
    ],
  },
  { code: '1300', name: 'Accounts Receivable',       type: 'asset', side: 'debit', control: true },
  { code: '1400', name: 'Inventory',                 type: 'asset', side: 'debit', control: true },
  {
    code: '1500', name: 'Other current assets',      type: 'asset', side: 'debit', postable: false,
    children: [
      { code: '1510', name: 'Prepayments',           type: 'asset', side: 'debit' },
      { code: '1520', name: 'Security deposits',     type: 'asset', side: 'debit' },
    ],
  },
  {
    code: '1600', name: 'Fixed assets',              type: 'asset', side: 'debit', postable: false,
    children: [
      { code: '1610', name: 'Vehicles — cost',                       type: 'asset', side: 'debit'  },
      { code: '1611', name: 'Vehicles — accumulated depreciation',   type: 'asset', side: 'credit' },
      { code: '1620', name: 'F&E — cost',                            type: 'asset', side: 'debit'  },
      { code: '1621', name: 'F&E — accumulated depreciation',        type: 'asset', side: 'credit' },
    ],
  },

  { code: '2100', name: 'Accounts Payable',          type: 'liability', side: 'credit', control: true },
  { code: '2200', name: 'Salaries payable',          type: 'liability', side: 'credit' },
  { code: '2300', name: 'Other current liabilities', type: 'liability', side: 'credit' },
  { code: '2400', name: 'Loans payable',             type: 'liability', side: 'credit' },

  { code: '3100', name: 'Owner\'s capital',          type: 'equity', side: 'credit' },
  { code: '3200', name: 'Retained earnings',         type: 'equity', side: 'credit' },
  { code: '3300', name: 'Owner\'s drawings',         type: 'equity', side: 'debit'  },

  { code: '4100', name: 'Sales revenue',             type: 'revenue', side: 'credit' },
  { code: '4200', name: 'Sales returns',             type: 'revenue', side: 'debit'  },
  { code: '4300', name: 'Sales discounts',           type: 'revenue', side: 'debit'  },
  { code: '4400', name: 'Other income',              type: 'revenue', side: 'credit' },

  { code: '5100', name: 'Cost of goods sold',        type: 'cogs',    side: 'debit'  },
  { code: '5200', name: 'Inventory variance',        type: 'cogs',    side: 'debit'  },
  { code: '5300', name: 'Inventory write-off',       type: 'cogs',    side: 'debit'  },

  { code: '6100', name: 'Salaries & wages',          type: 'expense', side: 'debit'  },
  {
    code: '6200', name: 'Vehicle expenses',          type: 'expense', side: 'debit',  postable: false,
    children: [
      { code: '6210', name: 'Fuel',                  type: 'expense', side: 'debit' },
      { code: '6220', name: 'Maintenance',           type: 'expense', side: 'debit' },
      { code: '6230', name: 'Insurance',             type: 'expense', side: 'debit' },
    ],
  },
  { code: '6300', name: 'Rent',                      type: 'expense', side: 'debit' },
  { code: '6400', name: 'Utilities',                 type: 'expense', side: 'debit' },
  { code: '6500', name: 'Office expenses',           type: 'expense', side: 'debit' },
  { code: '6600', name: 'Professional fees',         type: 'expense', side: 'debit' },
  { code: '6700', name: 'Bank charges',              type: 'expense', side: 'debit' },
  { code: '6800', name: 'Depreciation',              type: 'expense', side: 'debit' },
  { code: '6900', name: 'Miscellaneous',             type: 'expense', side: 'debit' },
];

async function insertNode(
  sql: Sql,
  orgId: string,
  node: CoaNode,
  parentId: string | null,
): Promise<void> {
  const isHeader = node.children && node.children.length > 0;
  const postable = node.postable ?? !isHeader;
  const control = node.control ?? false;

  const [row] = await sql<Array<{ id: string }>>`
    INSERT INTO gl_accounts (org_id, code, name, type, normal_side, parent_id, is_postable, is_control)
    VALUES (
      ${orgId}, ${node.code}, ${node.name}, ${node.type}, ${node.side},
      ${parentId}, ${postable}, ${control}
    )
    ON CONFLICT (org_id, code) DO UPDATE SET
      name        = EXCLUDED.name,
      type        = EXCLUDED.type,
      normal_side = EXCLUDED.normal_side,
      parent_id   = EXCLUDED.parent_id,
      is_postable = EXCLUDED.is_postable,
      is_control  = EXCLUDED.is_control
    RETURNING id
  `;
  const id = row!.id;
  for (const child of node.children ?? []) {
    await insertNode(sql, orgId, child, id);
  }
}

export async function seedDefaultCoa(sql: Sql, orgId: string): Promise<void> {
  for (const node of COA) {
    await insertNode(sql, orgId, node, null);
  }
}

/**
 * Open the cutover period (current month) so JEs can post immediately.
 * Idempotent.
 */
export async function ensureCurrentPeriod(sql: Sql, orgId: string): Promise<void> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  await sql`
    INSERT INTO gl_periods (org_id, year, month, status)
    VALUES (${orgId}, ${year}, ${month}, 'open')
    ON CONFLICT (org_id, year, month) DO NOTHING
  `;
}
