import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Scripture Review',
  description: 'Spaced-repetition review session for memorizing scripture.',
};

// The UI chrome is English (LTR); each passage sets its own dir/lang when rendered.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
