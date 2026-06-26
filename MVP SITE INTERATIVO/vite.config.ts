import path from 'path'
import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath } from 'url'
import { adminMediaPlugin } from './vite/adminMediaPlugin'

const root = path.dirname(fileURLToPath(import.meta.url))
const generatedConfigDir = path.join(root, 'src', 'config', 'generated')

/** Evita page reload do Vite quando a API grava JSON de config no editor. */
function ignoreGeneratedConfigHmr(): Plugin {
  return {
    name: 'ignore-generated-config-hmr',
    handleHotUpdate({ file }) {
      if (file.startsWith(generatedConfigDir)) {
        return []
      }
    },
  }
}

export default defineConfig({
  plugins: [adminMediaPlugin(), ignoreGeneratedConfigHmr()],
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(root, 'index.html'),
        edit: path.resolve(root, 'edit.html'),
        admin: path.resolve(root, 'admin.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'vendor-three'
          if (id.includes('/edit/bookEditor')) return 'edit-book'
          if (
            id.includes('/edit/apartmentsEditor') ||
            id.includes('/edit/apartmentPinsEditor') ||
            id.includes('/edit/apartmentHighlight')
          ) {
            return 'edit-apartments'
          }
          if (id.includes('/edit/dockEditor')) return 'edit-dock'
          if (id.includes('/edit/insolationPanel')) return 'edit-insolation'
        },
      },
    },
  },
  server: {
    port: 5174,
    strictPort: false,
    host: true,
    open: false,
    watch: {
      ignored: [generatedConfigDir],
    },
  },
  preview: {
    port: 4174,
    strictPort: false,
    host: true,
  },
})
