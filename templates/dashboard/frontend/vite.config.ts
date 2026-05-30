import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

const dashboardApiTarget = process.env.THOTH_DASHBOARD_API_TARGET ?? 'http://localhost:8501'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: dashboardApiTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@vue-flow') || id.includes('dagre') || id.includes('elkjs')) return 'viz-flow'
          if (id.includes('codemirror') || id.includes('@codemirror')) return 'editor'
          if (id.includes('@tanstack')) return 'tables'
          if (id.includes('echarts') || id.includes('uplot')) return 'charts'
          if (id.includes('reka-ui') || id.includes('@vueuse')) return 'ui-primitives'
          if (id.includes('vue') || id.includes('pinia')) return 'vue-core'
          return 'vendor'
        },
      },
    },
  },
})
