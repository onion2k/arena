import { writeFileSync, mkdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev-only: POST a data URL to /__shot and it lands in docs/. The canvas
 * cannot hand a file to anything itself — a preview pane blocks downloads —
 * and a screenshot of the pane is a screenshot of the pane, not of the frame.
 */
const capture = (): Plugin => ({
  name: 'capture',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const [, data] = body.split(',');
        mkdirSync('docs', { recursive: true });
        writeFileSync('docs/arena.png', Buffer.from(data, 'base64'));
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  plugins: [capture()],
  // The renderer is linked during development, and Vite's watcher ignores
  // everything under node_modules: without this an edit to it serves stale.
  server: { port: 5190, strictPort: true, watch: { ignored: ['!**/node_modules/artshape-render/**'] } },
  optimizeDeps: { exclude: ['artshape-render'] },
});
