import type { NextConfig } from 'next';

const config: NextConfig = {
  // PDF.js resolves its worker, fonts and CMaps as local Node.js assets.
  // Bundled require.resolve calls become module IDs rather than filesystem paths.
  serverExternalPackages: ['pdfjs-dist'],
};

export default config;
