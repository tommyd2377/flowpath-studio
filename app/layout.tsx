import type { Metadata } from 'next';
import './globals.css';
import { appearanceTheme } from '@/lib/appearance-theme';
import { WAVEFORM_DEFAULT_COLOR } from '@/lib/account-model';
import AppStartup from '@/components/AppStartup';

const appName = 'FlowPath Studio';

export const metadata: Metadata = {
  title: appName,
  applicationName: appName,
  other: { 'apple-mobile-web-app-title': appName },
  description: 'A quiet space for a natural voice conversation.',
  icons: { icon: '/brand/flowpath-icon-square.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" style={appearanceTheme(WAVEFORM_DEFAULT_COLOR)}><body><AppStartup>{children}</AppStartup></body></html>;
}
