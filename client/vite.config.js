import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const legacyFile = path.resolve(process.cwd(), '../public/index.html');
const candidateBridgeFile = path.resolve(process.cwd(), 'src/legacyCandidateBridge.js');

function getLegacyHtml() {
  const html = fs.readFileSync(legacyFile, 'utf8');
  const bridge = fs.readFileSync(candidateBridgeFile, 'utf8');
  return html.replace('</body>', `<script>${bridge}</script>\n</body>`);
}

function legacyFrontendPlugin() {
  return {
    name: 'grateful-edutech-legacy-frontend',
    configureServer(server) {
      server.middlewares.use('/legacy.html', (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(getLegacyHtml());
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'legacy.html',
        source: getLegacyHtml()
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), legacyFrontendPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:5000'
    },
    fs: {
      allow: ['..']
    }
  }
});
