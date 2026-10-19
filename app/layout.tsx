import type { Metadata } from 'next';
import './globals.css';
import { appearanceTheme } from '@/lib/appearance-theme';
import { WAVEFORM_DEFAULT_COLOR } from '@/lib/account-model';

export const metadata: Metadata = {
  title: 'FlowPath — The Voice',
  description: 'A quiet space for a natural voice conversation.',
  icons: { icon: '/brand/flowpath-icon-square.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" style={appearanceTheme(WAVEFORM_DEFAULT_COLOR)}><body>{children}</body></html>;
}
