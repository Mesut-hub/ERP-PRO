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
    section: 'Sales',
    items: [
      { href: '/sales/orders', label: 'Orders' },
      { href: '/sales/deliveries', label: 'Deliveries' },
      { href: '/sales/returns', label: 'Returns' },
      { href: '/sales/invoices', label: 'Invoices' },
      { href: '/sales/invoices/new', label: 'New Invoice' },
    ],
  },
  {
    section: 'Inventory',
    items: [
      { href: '/inventory/moves', label: 'Stock Moves' },
      { href: '/inventory/stock-valuation', label: 'Stock Valuation' },
    ],
  },
  {
    section: 'Master Data',
    items: [
      { href: '/master-data/warehouses', label: 'Warehouses' },
      { href: '/master-data/products', label: 'Products' },
      { href: '/master-data/exchange-rates', label: 'Exchange Rates' }
    ],
  },
];

function abbr(section: string, label: string) {
  const s = (section.trim()[0] ?? '?').toUpperCase();
  const l = (label.trim()[0] ?? '?').toUpperCase();
  return `${s}${l}`;
}

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
                    collapsed && 'justify-center px-0',
                  )}
                  title={`${g.section} • ${it.label}`}
                >
                  {!collapsed ? (
                    <span>{it.label}</span>
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex h-7 w-10 items-center justify-center rounded-md border border-border bg-background text-[11px] font-semibold',
                        active && 'bg-muted',
                      )}
                    >
                      {abbr(g.section, it.label)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}