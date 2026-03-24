import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UEI Cloud — Unified Energy Interface',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
        {/* Apply saved theme before first paint to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('uei-theme')==='light')document.documentElement.classList.add('light');}catch(e){}})();` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
