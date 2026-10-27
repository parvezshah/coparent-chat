import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Co-Parent — chart-grounded chat demo',
  description:
    "Demo of an AI parenting companion whose system prompt is built from each child's Human Design chart, by Parvez @ Taraveen.",
  robots: 'noindex',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
