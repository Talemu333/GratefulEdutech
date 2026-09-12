import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const legacyFile = path.resolve(process.cwd(), '../public/index.html');
const candidateBridgeFile = path.resolve(process.cwd(), 'src/legacyCandidateBridge.js');

function getLegacyHtml() {
  // Keep the client's original HTML untouched. The bridge is loaded separately
  // so its JavaScript cannot corrupt the original inline script block.
  const html = fs.readFileSync(legacyFile, 'utf8');
  return html.replace('</body>', '<script src="/legacy-bridge.js"></script>\n</body>');
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

      server.middlewares.use('/legacy-bridge.js', (_req, res) => {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.end(fs.readFileSync(candidateBridgeFile, 'utf8'));
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'legacy.html',
        source: getLegacyHtml()
      });
      this.emitFile({
        type: 'asset',
        fileName: 'legacy-bridge.js',
        source: fs.readFileSync(candidateBridgeFile, 'utf8')
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
