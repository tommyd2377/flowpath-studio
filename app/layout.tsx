import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FlowPath — The Voice',
  description: 'A quiet space for a natural voice conversation.',
  icons: { icon: '/brand/flowpath-icon-square.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
