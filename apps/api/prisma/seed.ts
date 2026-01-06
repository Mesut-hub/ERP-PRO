import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Welcome-123';

  // 1) permissions (start minimal; we will expand module-by-module)
  const permissions = [
    'admin.user.manage',
    'admin.role.manage',
    'admin.permission.manage',
    'audit.read',

    // master data
    'md.currency.read',
    'md.exchange_rate.read',
    'md.exchange_rate.manage',
    'md.vat.read',
    'md.vat.manage',
    'md.unit.read',
    'md.unit.manage',
    'md.party.read',
    'md.party.manage',
    'md.product.read',
    'md.product.manage',
    'md.currency.manage',

    'inv.move.manage',
    'inv.move.post',
    'inv.onhand.read',
    'inv.move.read',

    'inv.move.cancel',
    'inv.move.reverse',
    'inv.warehouse.read',

    'pur.po.manage',
    'pur.po.approve',
    'pur.po.receive',
    'pur.invoice.read',
    'pur.invoice.manage',
    'pur.invoice.post',
    'pur.po.read',

    'acc.account.manage',
    'acc.journal.read',
    'acc.journal.manage',
    'acc.journal.post',
    'acc.account.read',

    'sales.order.manage',
    'sales.order.approve',
    'sales.order.deliver',
    'sales.invoice.read',
    'sales.invoice.manage',
    'sales.invoice.post',
    'sales.order.read',
    'sales.return.manage',
    'sales.delivery.cost.backfill',

    'sales.credit.override',

    'pay.payment.manage',
    'pay.payment.post',
    'pay.payment.read',

    'ar.read',
    'ap.read',
    'pay.allocation.draft.override',
    'pay.post.draft_allocations.override',

    'fin.period.read',
    'fin.period.manage',
    'fin.posting.override',
  ];

  for (const code of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: code },
    });
  }

  // 2) admin role
  const adminRole = await prisma.role.upsert({
    where: { code: 'ADMIN' },
    update: { name: 'Administrator' },
    create: { code: 'ADMIN', name: 'Administrator' },
  });

  // 3) role-permissions
  const dbPermissions = await prisma.permission.findMany({
    where: { code: { in: permissions } },
  });

  for (const p of dbPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: p.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: p.id },
    });
  }

  // 4) admin user
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { fullName: 'Admin', passwordHash, status: 'ACTIVE' },
    create: {
      email: adminEmail,
      fullName: 'Admin',
      passwordHash,
      status: 'ACTIVE',
      preferredLocale: 'en',
    },
  });

    // --- Master Data seeds ---
  await prisma.currency.upsert({
    where: { code: 'TRY' },
    update: { isBase: true, isActive: true, name: 'Turkish Lira', symbol: '₺' },
    create: { code: 'TRY', name: 'Turkish Lira', symbol: '₺', isBase: true, isActive: true },
  });

  await prisma.currency.upsert({
    where: { code: 'USD' },
    update: { isActive: true, name: 'US Dollar', symbol: '$' },
    create: { code: 'USD', name: 'US Dollar', symbol: '$', isBase: false, isActive: true },
  });

  await prisma.currency.upsert({
    where: { code: 'EUR' },
    update: { isActive: true, name: 'Euro', symbol: '€' },
    create: { code: 'EUR', name: 'Euro', symbol: '€', isBase: false, isActive: true },
  });

  const vatRates = [
    { code: 'KDV_0' as const, name: 'KDV %0', percent: '0.00' },
    { code: 'KDV_1' as const, name: 'KDV %1', percent: '1.00' },
    { code: 'KDV_10' as const, name: 'KDV %10', percent: '10.00' },
    { code: 'KDV_20' as const, name: 'KDV %20', percent: '20.00' },
  ];

  for (const v of vatRates) {
    await prisma.vatRate.upsert({
      where: { code: v.code },
      update: { name: v.name, percent: v.percent as any, isActive: true },
      create: { code: v.code, name: v.name, percent: v.percent as any, isActive: true },
    });
  }

  await prisma.unit.upsert({
    where: { code: 'PCS' },
    update: { isActive: true, name: 'Pieces' },
    create: { code: 'PCS', name: 'Pieces', isActive: true },
  });

    // --- Inventory seeds ---
  const mainWh = await prisma.warehouse.upsert({
    where: { code: 'MAIN' },
    update: { name: 'Main Warehouse', isActive: true },
    create: { code: 'MAIN', name: 'Main Warehouse', isActive: true },
  });

  await prisma.warehouseLocation.upsert({
    where: { warehouseId_code: { warehouseId: mainWh.id, code: 'DEFAULT' } },
    update: { name: 'Default Location', isActive: true },
    create: { warehouseId: mainWh.id, code: 'DEFAULT', name: 'Default Location', isActive: true },
  });

    // --- Accounting seeds (minimal starter CoA) ---
  const accounts = [
    { code: '100', name: 'Cash', type: 'ASSET' as const },
    { code: '102', name: 'Bank', type: 'ASSET' as const },
    { code: '120', name: 'Accounts Receivable (AR)', type: 'ASSET' as const },
    { code: '150', name: 'Inventory', type: 'ASSET' as const },
    { code: '191', name: 'Deductible VAT (KDV)', type: 'ASSET' as const },

    { code: '320', name: 'Accounts Payable (AP)', type: 'LIABILITY' as const },
    { code: '327', name: 'Goods Received Not Invoiced (GRNI)', type: 'LIABILITY' as const },

    // NEW: Purchase Returns Clearing (after-invoice returns awaiting SCN matching)
    { code: '328', name: 'Purchase Returns Clearing', type: 'LIABILITY' as const },

    { code: '391', name: 'VAT Payable (KDV)', type: 'LIABILITY' as const },

    { code: '600', name: 'Sales Revenue', type: 'REVENUE' as const },
    { code: '621', name: 'Cost of Goods Sold (COGS)', type: 'EXPENSE' as const },
    { code: '770', name: 'General Administrative Expenses', type: 'EXPENSE' as const },
  ];

  for (const a of accounts) {
    await prisma.account.upsert({
      where: { code: a.code },
      update: { name: a.name, type: a.type, isActive: true },
      create: { code: a.code, name: a.name, type: a.type, isActive: true },
    });
  }

  // 5) assign role to admin
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  await prisma.systemSetting.upsert({
    where: { key: 'POSTING_LOCK_DATE' },
    update: { value: '1970-01-01' },
    create: { key: 'POSTING_LOCK_DATE', value: '1970-01-01' },
  });

  // Create a fiscal period for current month if missing
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const code = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  await prisma.fiscalPeriod.upsert({
    where: { code },
    update: { startDate: start, endDate: end },
    create: { code, startDate: start, endDate: end, status: 'OPEN' },
  });

  // --- NEW: initialize DocumentSequence rows for today (optional but recommended) ---
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dayKey = `${y}${m}${d}`;

  const seqCodes = ['JE', 'PO', 'GRN', 'SI', 'SO', 'DEL', 'PAY', 'MOV', 'CCN', 'CDN', 'SCN', 'SDN'];

  for (const sc of seqCodes) {
    await prisma.documentSequence.upsert({
      where: { sequenceCode_periodKey: { sequenceCode: sc, periodKey: dayKey } },
      update: {},
      create: { sequenceCode: sc, periodKey: dayKey, nextNumber: 1 },
    });
  }

  console.log('Seed completed.');
  console.log('Admin email:', adminEmail);
  console.log('Admin password:', adminPassword);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });