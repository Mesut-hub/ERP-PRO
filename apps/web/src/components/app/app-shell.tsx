'use client';

import { useEffect, useMemo, useState } from 'react';
import { SidebarNav } from './sidebar-nav';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile drawer on escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const sidebarWidth = useMemo(() => (collapsed ? 'w-[68px]' : 'w-[260px]'), [collapsed]);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:flex-col border-r border-border bg-card',
          sidebarWidth,
        )}
      >
        <div className="h-14 flex items-center justify-between px-3 border-b border-border">
          <div className={cn('font-semibold text-sm', collapsed && 'sr-only')}>ERP-PRO</div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
          >
            {collapsed ? '»' : '«'}
          </Button>
        </div>
        <SidebarNav collapsed={collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-[280px] bg-card border-r border-border">
            <div className="h-14 flex items-center justify-between px-3 border-b border-border">
              <div className="font-semibold text-sm">ERP-PRO</div>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                ✕
              </Button>
            </div>
            <SidebarNav collapsed={false} />
          </div>
        </div>
      )}

      {/* Main */}
      <div className={cn('md:pl-[260px]', collapsed && 'md:pl-[68px]')}>
        <header className="sticky top-0 z-20 h-14 border-b border-border bg-background/80 backdrop-blur">
          <div className="h-14 px-4 flex items-center gap-3">
            <Button
              className="md:hidden"
              variant="outline"
              size="sm"
              onClick={() => setMobileOpen(true)}
            >
              Menu
            </Button>
            <div className="text-sm text-muted-foreground">
              Professional ERP • <span className="text-foreground font-medium">Web</span>
            </div>
            <div className="ml-auto text-sm text-muted-foreground">Admin</div>
          </div>
        </header>

        <main className="p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}