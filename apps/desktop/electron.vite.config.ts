import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// electron-vite builds three targets into out/:
//   main      out/main/index.js        Electron main process (CJS). Dependencies listed under "dependencies" stay
//                                      external; the @galley/* workspace packages are devDependencies on purpose, so
//                                      they are bundled from TypeScript source and need no build step of their own.
//   preload   out/preload/index.js     contextBridge API (CJS, sandbox compatible)
//   renderer  out/renderer/**          two HTML entries, both of which import @galley/render:
//                                        renderer/index.html      the editor window
//                                        export-page/index.html   the hidden export window (lane A)
// The renderer root is src/ so the two entries keep their folder names in the output
// (out/renderer/renderer/index.html and out/renderer/export-page/index.html).
export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          renderer: resolve(__dirname, 'src/renderer/index.html'),
          'export-page': resolve(__dirname, 'src/export-page/index.html'),
        },
      },
    },
  },
});
