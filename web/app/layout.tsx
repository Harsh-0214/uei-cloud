import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import Chatbot from '@/components/Chatbot';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'UEI Cloud Dashboard',
  description: 'Real-time BMS telemetry monitoring',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-950 text-slate-100 min-h-screen`}>
        {children}
        <Chatbot />
      </body>
    </html>
  );
}
