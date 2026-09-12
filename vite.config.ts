import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * Where the renderer actually is: inside node_modules when it was installed,
 * and a checkout elsewhere on the disk when it was linked for working on both
 * at once. The path tracer builds its scene in a worker inside the library,
 * fetched by URL, so the dev server has to be allowed to serve from there —
 * without it the worker is fetched, fails to import what it needs, and dies
 * without a word, which looks like a traced frame that never arrives.
 */
const renderer = dirname(createRequire(import.meta.url).resolve('artshape-render/package.json'));

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
      // `?name=x` writes docs/x.png, for a series of captures compared side
      // by side; the hero image is the default so nothing that shoots it
      // needs to know
      const name = (new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'arena').replace(/[^\w-]/g, '');
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const [, data] = body.split(',');
        mkdirSync('docs', { recursive: true });
        writeFileSync(`docs/${name}.png`, Buffer.from(data, 'base64'));
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  plugins: [capture()],
  // The renderer is linked during development, and Vite's watcher ignores
  // everything under node_modules: without this an edit to it serves stale.
  server: {
    port: 5190, strictPort: true,
    watch: { ignored: ['!**/node_modules/artshape-render/**'] },
    fs: { allow: ['.', renderer] },
  },
  optimizeDeps: { exclude: ['artshape-render'] },
});
