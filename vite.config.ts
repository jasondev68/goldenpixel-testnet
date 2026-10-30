import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

/**
 * The speech engine (onnxruntime-web, used by Transformers.js) refers to its WebAssembly files with
 * `new URL('ort-wasm-*.wasm', import.meta.url)`. Left alone, Vite would copy the 27 MB runtime into dist/, which is
 * far over the deploy size limit. At run time Transformers.js loads the runtime from the jsDelivr CDN anyway, so the
 * references are pointed at that same pinned CDN path instead of being bundled.
 */
function ortRuntimeFromCdn(): Plugin {
  const version = (JSON.parse(readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')) as { version: string }).version
  const base = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`
  return {
    name: 'gp-ort-runtime-from-cdn',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!/onnxruntime-web[\\/]dist[\\/]/.test(id) || !code.includes('ort-wasm')) return null
      return code.replace(/new URL\((["'])(ort-wasm[^"']+)\1,\s*import\.meta\.url\)/g, (_m, _q: string, file: string) => `new URL(${JSON.stringify(base + file)})`)
    },
  }
}

export default defineConfig({
  plugins: [react(), nodePolyfills(), ortRuntimeFromCdn()],
  worker: { format: 'es', plugins: () => [ortRuntimeFromCdn()] },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
  },
})
