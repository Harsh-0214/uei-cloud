import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UEI Cloud Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="text-slate-200 min-h-screen">{children}</body>
    </html>
  );
}
