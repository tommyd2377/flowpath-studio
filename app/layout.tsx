import type { Metadata } from 'next';
import './globals.css';
import '@thevoice/platform-ui/styles.css';

export const metadata: Metadata = {
  title: 'Voice Studio',
  description: 'Create and manage your own voice-led website.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="dark" suppressHydrationWarning>
    <head><script dangerouslySetInnerHTML={{ __html: `try{var theme=localStorage.getItem('voice-studio-theme');document.documentElement.dataset.theme=theme==='light'?'light':'dark'}catch{document.documentElement.dataset.theme='dark'}` }}/></head>
    <body>{children}</body>
  </html>;
}
