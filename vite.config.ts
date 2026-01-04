import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { nodePolyfills, PolyfillOptions } from 'vite-plugin-node-polyfills';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import type { Plugin } from 'vite';
import * as path from 'path';

// Fix for node polyfills in workspace setups
// https://github.com/davidmyersdev/vite-plugin-node-polyfills/issues/81
const nodePolyfillsFix = (options?: PolyfillOptions): Plugin => {
  return {
    ...nodePolyfills(options),
    resolveId(source: string) {
      const m = /^vite-plugin-node-polyfills\/shims\/(buffer|global|process)$/.exec(source);
      if (m) {
        return `./node_modules/vite-plugin-node-polyfills/shims/${m[1]}/dist/index.cjs`;
      }
    },
  } as Plugin;
};

// Plugin to fix WASM URL resolution in noir packages
// These packages use `new URL('xxx.wasm', import.meta.url)` which breaks with Vite's pre-bundling
const fixNoirWasmUrls = (): Plugin => {
  return {
    name: 'fix-noir-wasm-urls',
    transform(code, id) {
      // Only transform noir-acvm_js and noir-noirc_abi web modules
      if (id.includes('noir-acvm_js') && id.includes('/web/') && id.endsWith('.js')) {
        const transformed = code.replace(
          /new URL\(['"]acvm_js_bg\.wasm['"],\s*import\.meta\.url\)/g,
          `new URL('/assets/acvm/acvm_js_bg.wasm', window.location.origin)`
        );
        // Return object with map: null to suppress sourcemap warnings
        return transformed !== code ? { code: transformed, map: null } : null;
      }
      if (id.includes('noir-noirc_abi') && id.includes('/web/') && id.endsWith('.js')) {
        const transformed = code.replace(
          /new URL\(['"]noirc_abi_wasm_bg\.wasm['"],\s*import\.meta\.url\)/g,
          `new URL('/assets/noirc_abi/noirc_abi_wasm_bg.wasm', window.location.origin)`
        );
        return transformed !== code ? { code: transformed, map: null } : null;
      }
      // Return null to indicate no transformation
      return null;
    },
  };
};

export default defineConfig({
  plugins: [
    nodePolyfillsFix({
      include: ['buffer', 'process', 'util', 'stream', 'events', 'path'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    // Fix WASM URL resolution before other transformations
    fixNoirWasmUrls(),
    // Copy WASM files to assets directory so they can be served correctly
    viteStaticCopy({
      targets: [
        {
          // noir-acvm_js WASM files
          src: 'node_modules/.pnpm/@aztec+noir-acvm_js@*/node_modules/@aztec/noir-acvm_js/web/*.wasm',
          dest: 'assets/acvm',
        },
        {
          // noir-noirc_abi WASM files
          src: 'node_modules/.pnpm/@aztec+noir-noirc_abi@*/node_modules/@aztec/noir-noirc_abi/web/*.wasm',
          dest: 'assets/noirc_abi',
        },
        {
          // bb.js WASM files (threads build; required for browser backend)
          src: 'node_modules/@aztec/bb.js/dest/node/barretenberg_wasm/barretenberg-threads.wasm.gz',
          dest: 'assets/bb',
        },
      ],
    }),
  ],

  server: {
    port: 5555,
    // Required headers for bb.js WASM multithreading (SharedArrayBuffer)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    // Allow vite to serve files from node_modules for WASM and artifacts
    fs: {
      allow: [
        searchForWorkspaceRoot(process.cwd()),
      ],
    },
  },

  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  build: {
    target: 'esnext',
    sourcemap: 'hidden',
  },

  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    // Exclude noir WASM packages from pre-bundling so our transform plugin can fix URLs
    exclude: [
      '@aztec/noir-acvm_js',
      '@aztec/noir-noirc_abi',
      '@aztec/bb.js',
    ],
  },

  define: {
    'process.env': JSON.stringify({}),
  },

  // Handle WASM files properly
  assetsInclude: ['**/*.wasm', '**/*.wasm.gz'],

  // Resolve configuration for browser environment
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
  },
});
