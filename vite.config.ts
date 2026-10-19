import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

const version = readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim()

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'logo.svg',
        'icon-180.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
      ],
      manifest: {
        name: 'bit_pouch',
        short_name: 'bit_pouch',
        description: '开发者的随身工具袋 · A pocket toolbox for builders',
        theme_color: '#0a0d0b',
        background_color: '#0a0d0b',
        display: 'standalone',
        start_url: './',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          framework: ['vue', 'vue-router', 'pinia'],
        },
        // 多个插件的 run.ts 会生成同名 chunk；显式带 hash 避免 .map 互相覆盖。
        sourcemapFileNames: 'assets/[name]-[hash].map',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // src-tauri/target 的 Rust 构建产物会被 cargo/OneDrive 锁定，
      // chokidar 监听到会抛 EBUSY 直接杀死 dev server。
      ignored: ['**/src-tauri/target/**', '**/dist/**', '**/dev-dist/**'],
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.{ts,js}'],
    reporters: 'default',
  },
})
