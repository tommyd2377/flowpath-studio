import type { Metadata } from 'next';
import './globals.css';
import '@thevoice/platform-ui/styles.css';

export const metadata: Metadata = {
  title: 'FlowPath Studio',
  description: 'Create and manage your own FlowPath website.',
  icons: {
    icon: '/brand/flowpath-icon-square.png',
    shortcut: '/brand/flowpath-icon-square.png',
    apple: '/brand/flowpath-icon-square.png',
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="dark" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: `try{var theme=localStorage.getItem('voice-studio-theme');document.documentElement.dataset.theme=theme==='light'?'light':'dark'}catch{document.documentElement.dataset.theme='dark'}` }}/></head>
    <body>{children}</body>
  </html>;
}
