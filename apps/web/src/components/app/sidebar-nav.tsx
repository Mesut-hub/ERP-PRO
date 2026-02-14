'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const nav = [
  {
    section: 'Accounting',
    items: [
      { href: '/accounting/ledger', label: 'Ledger' },
      { href: '/accounting/trial-balance', label: 'Trial Balance' },
      { href: '/accounting/grni', label: 'GRNI' },
    ],
  },
  {
    section: 'Purchasing',
    items: [
      { href: '/purchasing/invoices', label: 'Invoices' },
      { href: '/purchasing/returns', label: 'Returns' },
    ],
  },
  {
    section: 'Inventory',
    items: [{ href: '/inventory/stock-valuation', label: 'Stock Valuation' }],
  },
  {
    section: 'Master Data',
    items: [{ href: '/master-data/exchange-rates', label: 'Exchange Rates' }],
  },
];

export function SidebarNav({ collapsed }: { collapsed: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="px-3 py-3">
      {nav.map((g) => (
        <div key={g.section} className="mb-4">
          <div
            className={cn(
              'px-2 py-1 text-xs font-semibold text-muted-foreground',
              collapsed && 'sr-only',
            )}
          >
            {g.section}
          </div>
          <div className="space-y-1">
            {g.items.map((it) => {
              const active = pathname === it.href;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors',
                    active ? 'bg-muted font-medium' : 'hover:bg-muted/70',
                    collapsed && 'justify-center',
                  )}
                  title={collapsed ? it.label : undefined}
                >
                  <span className={cn(collapsed && 'sr-only')}>{it.label}</span>
                  {collapsed && <span aria-hidden className="text-xs">{it.label.slice(0, 2)}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}