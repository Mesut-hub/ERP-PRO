import './globals.css';
import { AppShell } from '@/components/app/app-shell';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="__tw_smoke_test">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}